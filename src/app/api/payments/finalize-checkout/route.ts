import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { createSessionToken, invalidateAuthCache, getCurrentUserId } from '@/lib/auth';
import { getSessionCookieDomain } from '@/lib/cookie-domain';
import { isSafeRedirectPath } from '@/lib/oauth-config';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sessionId, orderId, utr, pendingProject, returnTo } = body;

    const pool = getPgPool();
    let currentUserId = await getCurrentUserId();
    let sessionRecord: any = null;

    // 1. Locate payment session by ID, orderId, or utr
    if (sessionId) {
      const sRes = await pool.query(
        'SELECT * FROM fluxbase_global.payment_sessions WHERE id = $1',
        [parseInt(sessionId, 10)]
      );
      if (sRes.rows.length > 0) sessionRecord = sRes.rows[0];
    }

    if (!sessionRecord && orderId) {
      const sRes = await pool.query(
        'SELECT * FROM fluxbase_global.payment_sessions WHERE fluxpay_order_id = $1',
        [orderId]
      );
      if (sRes.rows.length > 0) sessionRecord = sRes.rows[0];
    }

    if (!sessionRecord && utr) {
      const sRes = await pool.query(
        'SELECT * FROM fluxbase_global.payment_sessions WHERE utr = $1',
        [utr]
      );
      if (sRes.rows.length > 0) sessionRecord = sRes.rows[0];
    }

    // Determine target user ID
    const targetUserId = sessionRecord?.user_id || currentUserId;
    if (!targetUserId) {
      return NextResponse.json({ success: false, error: 'User not identified' }, { status: 401 });
    }

    const host = req.headers.get('host') || '';
    const cookieDomain = getSessionCookieDomain(host);

    // 2. If session status is still pending, poll FluxPay gateway for immediate confirmation
    if (sessionRecord && sessionRecord.status === 'pending') {
      const fluxpayOrderId = sessionRecord.fluxpay_order_id || orderId;
      if (fluxpayOrderId) {
        try {
          const gw = process.env.FLUXPAY_GATEWAY_URL || 'https://payments.fluxbasedb.me';
          const fpRes = await fetch(`${gw}/api/v1/orders/${fluxpayOrderId}`);
          if (fpRes.ok) {
            const fpData = await fpRes.json();
            if (fpData.success && fpData.order?.status === 'paid') {
              sessionRecord.status = 'completed';
              const cleanPlan = sessionRecord.plan_type || 'pro';
              await pool.query(
                `UPDATE fluxbase_global.payment_sessions 
                 SET status = 'completed', utr = COALESCE($1, utr) 
                 WHERE id = $2`,
                [fpData.order.utr || utr || null, sessionRecord.id]
              );
              await pool.query(
                `UPDATE fluxbase_global.users 
                 SET plan_type = $1, user_role = $1, billing_cycle_end = NOW() + INTERVAL '1 month', status = 'active', updated_at = NOW() 
                 WHERE id = $2`,
                [cleanPlan, targetUserId]
              );
            }
          }
        } catch (checkErr) {
          logger.warn('[Finalize Checkout] FluxPay gateway check warning:', checkErr);
        }
      }
    }

    // 3. Clear all caches for the user so fresh plan takes effect immediately
    await invalidateAuthCache(targetUserId);

    // 4. Check for project to provision (from pendingProject payload or session.project_data)
    let rawProjectData = pendingProject || sessionRecord?.project_data;
    let provisionedProject: any = null;

    if (rawProjectData) {
      try {
        const pData = typeof rawProjectData === 'string' ? JSON.parse(rawProjectData) : rawProjectData;
        if (pData?.projectName) {
          const existing = await pool.query(
            "SELECT * FROM fluxbase_global.projects WHERE user_id = $1::text AND display_name = $2",
            [targetUserId, pData.projectName.trim()]
          );
          if (existing.rows.length > 0) {
            provisionedProject = existing.rows[0];
          } else {
            const { createProject } = await import('@/lib/data');
            const { TenantProvisioner } = await import('@/lib/tenant-engine');
            const userPlan = sessionRecord?.plan_type || 'employee';
            provisionedProject = await createProject(
              pData.projectName.trim(),
              pData.workDescription || 'Provisioned upon payment confirmation',
              pData.dialect || 'postgresql',
              pData.timezone || 'UTC',
              'internal',
              {},
              pData.userRole || userPlan,
              targetUserId
            );
            await TenantProvisioner.createTenantSchema(provisionedProject.project_id, pData.dialect || 'postgresql');
            await pool.query(
              'UPDATE fluxbase_global.projects SET creator_role = $1 WHERE project_id = $2',
              [pData.userRole || userPlan, provisionedProject.project_id]
            );
            logger.info(`[Finalize Checkout] Auto-provisioned project ${provisionedProject.project_id} for user ${targetUserId}`);
          }
        }
      } catch (projErr) {
        logger.error('[Finalize Checkout] Project provisioning error:', projErr);
      }
    }

    // 5. Determine active destination project and target URL
    let activeProject = provisionedProject;
    if (!activeProject) {
      // Find user's most recent project
      const pRes = await pool.query(
        'SELECT * FROM fluxbase_global.projects WHERE user_id = $1::text ORDER BY updated_at DESC LIMIT 1',
        [targetUserId]
      );
      if (pRes.rows.length > 0) {
        activeProject = pRes.rows[0];
      }
    }

    let targetUrl = '/dashboard/projects';
    if (isSafeRedirectPath(returnTo)) {
      targetUrl = returnTo;
    } else if (activeProject) {
      targetUrl = `/dashboard?projectId=${activeProject.project_id}`;
    }

    // 6. Build response and set cookies (session token + selectedProject)
    const res = NextResponse.json({
      success: true,
      targetUrl,
      projectName: activeProject?.display_name || null,
      projectId: activeProject?.project_id || null,
      plan: sessionRecord?.plan_type || null,
    });

    // Re-issue / refresh session cookie to ensure mobile browsers & cross-subdomain users remain authenticated
    const sessionToken = await createSessionToken(targetUserId, true);
    res.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      domain: cookieDomain,
      maxAge: 7 * 24 * 60 * 60,
    });

    if (activeProject) {
      res.cookies.set('selectedProject', JSON.stringify({
        project_id: activeProject.project_id,
        display_name: activeProject.display_name,
        dialect: activeProject.dialect,
        role: activeProject.creator_role || 'admin',
        schema_name: activeProject.schema_name || `flux_tenant_${activeProject.project_id}`
      }), {
        path: '/',
        domain: cookieDomain,
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    return res;
  } catch (err: any) {
    logger.error('[Finalize Checkout Error]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
