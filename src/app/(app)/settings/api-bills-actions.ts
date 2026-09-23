'use server';

import { getCurrentUserId } from '@/lib/auth';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';
import { ensureAiTablesExist } from '@/lib/ai-gateway/usage-ledger';

export interface ApiUsageLedgerItem {
  id: string;
  projectId: string | null;
  modelId: string;
  modality: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: string;
  costUsd: number;
  costInr: number;
  createdAt: string;
}

export interface ModelUsageBreakdown {
  modelId: string;
  label: string;
  provider: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costInr: number;
  percentage: number;
}

export interface ModalityUsageBreakdown {
  modality: string;
  requestCount: number;
  costUsd: number;
  costInr: number;
  percentage: number;
}

export interface ApiBillsProjectItem {
  id: string;
  name: string;
}

export interface ApiBillsData {
  summary: {
    totalAiRequests: number;
    totalDbRequests: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    totalCostInr: number;
    activeApiKeys: number;
    paygUnbilledAmountInr: number;
    cycleStart: string | null;
    cycleEnd: string | null;
  };
  modelBreakdown: ModelUsageBreakdown[];
  modalityBreakdown: ModalityUsageBreakdown[];
  ledger: ApiUsageLedgerItem[];
  projects?: ApiBillsProjectItem[];
}

const USD_TO_INR_RATE = 85.00;

export async function getApiBillsAction(projectId?: string): Promise<{ success: boolean; data?: ApiBillsData; error?: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: 'Unauthorized' };

  try {
    await ensureAiTablesExist();
    const pool = getPgPool();

    // 1. Fetch AI Usage Aggregates from fluxbase_global.ai_usage_log
    const aiParams: any[] = [userId];
    let aiProjectClause = '';
    if (projectId && projectId !== 'all') {
      if (projectId === 'unassigned') {
        aiProjectClause = 'AND project_id IS NULL';
      } else {
        aiParams.push(projectId);
        aiProjectClause = 'AND project_id = $2';
      }
    }

    const aiSummaryQuery = `
      SELECT 
        COUNT(*)::bigint AS total_requests,
        COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
        COALESCE(SUM(cost_estimate), 0)::numeric AS total_cost_usd
      FROM fluxbase_global.ai_usage_log
      WHERE user_id = $1 ${aiProjectClause};
    `;

    const modelBreakdownQuery = `
      SELECT 
        model_id,
        provider,
        COUNT(*)::bigint AS request_count,
        COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(cost_estimate), 0)::numeric AS cost_usd
      FROM fluxbase_global.ai_usage_log
      WHERE user_id = $1 ${aiProjectClause}
      GROUP BY model_id, provider
      ORDER BY cost_usd DESC, request_count DESC;
    `;

    const modalityBreakdownQuery = `
      SELECT 
        modality,
        COUNT(*)::bigint AS request_count,
        COALESCE(SUM(cost_estimate), 0)::numeric AS cost_usd
      FROM fluxbase_global.ai_usage_log
      WHERE user_id = $1 ${aiProjectClause}
      GROUP BY modality
      ORDER BY cost_usd DESC, request_count DESC;
    `;

    const ledgerQuery = `
      SELECT 
        id,
        project_id,
        model_id,
        modality,
        provider,
        input_tokens,
        output_tokens,
        latency_ms,
        status,
        cost_estimate,
        created_at
      FROM fluxbase_global.ai_usage_log
      WHERE user_id = $1 ${aiProjectClause}
      ORDER BY created_at DESC
      LIMIT 500;
    `;

    // 2. Fetch Active PAYG Meter & API Keys counts
    const paygParams: any[] = [userId];
    let paygProjectClause = '';
    if (projectId && projectId !== 'all') {
      if (projectId === 'unassigned') {
        paygProjectClause = 'AND project_id IS NULL';
      } else {
        paygParams.push(projectId);
        paygProjectClause = 'AND project_id = $2';
      }
    }

    const paygQuery = `
      SELECT 
        COALESCE(SUM(total_requests::bigint), 0) AS total_db_requests,
        COALESCE(SUM(calculated_amount::numeric), 0) AS payg_unbilled_amount,
        MIN(cycle_start) AS cycle_start,
        MAX(cycle_end) AS cycle_end
      FROM fluxbase_global.payg_usage_cycles
      WHERE user_id = $1 AND status = 'active' ${paygProjectClause};
    `;

    const apiKeyQuery = `
      SELECT COUNT(*)::int AS count 
      FROM fluxbase_global.api_keys 
      WHERE user_id = $1;
    `;

    const userProjectsQuery = `
      SELECT project_id, display_name 
      FROM fluxbase_global.projects 
      WHERE user_id = $1 
      ORDER BY display_name ASC;
    `;

    // Run queries concurrently
    const [aiSummaryRes, modelRes, modalityRes, ledgerRes, paygRes, apiKeyRes, userProjectsRes] = await Promise.all([
      pool.query(aiSummaryQuery, aiParams),
      pool.query(modelBreakdownQuery, aiParams),
      pool.query(modalityBreakdownQuery, aiParams),
      pool.query(ledgerQuery, aiParams),
      pool.query(paygQuery, paygParams),
      pool.query(apiKeyQuery, [userId]),
      pool.query(userProjectsQuery, [userId])
    ]);

    const totalAiReqs = parseInt(aiSummaryRes.rows[0]?.total_requests || '0', 10);
    const totalInputTokens = parseInt(aiSummaryRes.rows[0]?.total_input_tokens || '0', 10);
    const totalOutputTokens = parseInt(aiSummaryRes.rows[0]?.total_output_tokens || '0', 10);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const totalAiCostUsd = parseFloat(aiSummaryRes.rows[0]?.total_cost_usd || '0');
    const totalAiCostInr = Number((totalAiCostUsd * USD_TO_INR_RATE).toFixed(2));

    const totalDbReqs = parseInt(paygRes.rows[0]?.total_db_requests || '0', 10);
    const paygUnbilledInr = parseFloat(paygRes.rows[0]?.payg_unbilled_amount || '0');
    const cycleStart = paygRes.rows[0]?.cycle_start ? new Date(paygRes.rows[0].cycle_start).toISOString() : null;
    const cycleEnd = paygRes.rows[0]?.cycle_end ? new Date(paygRes.rows[0].cycle_end).toISOString() : null;

    const activeApiKeys = parseInt(apiKeyRes.rows[0]?.count || '0', 10);

    const projects: ApiBillsProjectItem[] = userProjectsRes.rows.map(r => ({
      id: r.project_id,
      name: r.display_name || r.project_id
    }));

    // Format Model Breakdown
    const modelBreakdown: ModelUsageBreakdown[] = modelRes.rows.map(row => {
      const cUsd = parseFloat(row.cost_usd || '0');
      const reqCount = parseInt(row.request_count || '0', 10);
      const pct = totalAiCostUsd > 0 
        ? Number(((cUsd / totalAiCostUsd) * 100).toFixed(1)) 
        : (totalAiReqs > 0 ? Number(((reqCount / totalAiReqs) * 100).toFixed(1)) : 0);

      const mId = (row.model_id || 'flux-fast').toLowerCase();
      let label = row.model_id || 'flux-fast';
      if (mId === 'flux-video') label = 'Flux Video Motion (CogVideoX)';
      else if (mId === 'flux-image') label = 'Flux Image (CogView-3 / DALL-E)';
      else if (mId === 'flux-image-fast') label = 'Flux Image Fast (CogView-3 Flash)';
      else if (mId === 'flux-embed' || mId.includes('titan-embed') || mId.includes('embed')) label = 'Flux Vector Embeddings (Titan V2)';
      else if (mId.includes('stt') || mId.includes('whisper')) label = 'Flux Audio STT (Whisper)';
      else if (mId.includes('tts') || mId.includes('speech')) label = 'Flux Audio TTS (Polly / Speech)';
      else if (mId.includes('nova-pro')) label = 'Flux Ultra (Amazon Nova Pro)';
      else if (mId.includes('nova-lite')) label = 'Flux Lite (Amazon Nova Lite)';
      else if (mId.includes('nova-micro')) label = 'Flux Micro (Amazon Nova Micro)';
      else if (mId.includes('flash') && mId.includes('4v')) label = 'Flux Vision (GLM-4V)';
      else if (mId.includes('flash')) label = 'Flux Fast (GLM-4 Flash)';
      else if (mId.includes('air')) label = 'Flux Pro (GLM-4 Air)';
      else if (mId.includes('plus')) label = 'Flux Ultra (GLM-4 Plus)';
      else if (mId.includes('llama') || mId.includes('turbo')) label = 'Flux Turbo (Groq LLaMA)';
      else if (mId.includes('gemini') || mId.includes('omni')) label = 'Flux Omni (Gemini 2.0)';
      else if (mId.includes('gpt-4o')) label = 'Flux Max (GPT-4o)';
      else if (mId === 'flux-pro') label = 'Flux Pro (GLM-4 Air / Nova Pro)';
      else if (mId === 'flux-ultra') label = 'Flux Ultra (GLM-4 Plus / Nova Pro)';
      else if (mId === 'flux-5.2') label = 'Flux 5.2 (Amazon Nova Pro)';
      else if (mId === 'flux') label = 'Flux Standard (GLM / Nova)';

      return {
        modelId: mId,
        label,
        provider: row.provider || 'glm',
        requestCount: reqCount,
        inputTokens: parseInt(row.input_tokens || '0', 10),
        outputTokens: parseInt(row.output_tokens || '0', 10),
        costUsd: Number(cUsd.toFixed(6)),
        costInr: Number((cUsd * USD_TO_INR_RATE).toFixed(4)),
        percentage: pct
      };
    });

    // Format Modality Breakdown
    const modalityBreakdown: ModalityUsageBreakdown[] = modalityRes.rows.map(row => {
      const reqCount = parseInt(row.request_count || '0', 10);
      const cUsd = parseFloat(row.cost_usd || '0');
      const pct = totalAiReqs > 0 ? Number(((reqCount / totalAiReqs) * 100).toFixed(1)) : 0;
      return {
        modality: row.modality || 'text',
        requestCount: reqCount,
        costUsd: Number(cUsd.toFixed(6)),
        costInr: Number((cUsd * USD_TO_INR_RATE).toFixed(4)),
        percentage: pct
      };
    });

    // Format Ledger Items
    const ledger: ApiUsageLedgerItem[] = ledgerRes.rows.map(row => {
      const inTok = parseInt(row.input_tokens || '0', 10);
      const outTok = parseInt(row.output_tokens || '0', 10);
      const cUsd = parseFloat(row.cost_estimate || '0');
      return {
        id: row.id,
        projectId: row.project_id,
        modelId: row.model_id,
        modality: row.modality,
        provider: row.provider,
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: inTok + outTok,
        latencyMs: parseInt(row.latency_ms || '0', 10),
        status: row.status || 'success',
        costUsd: Number(cUsd.toFixed(6)),
        costInr: Number((cUsd * USD_TO_INR_RATE).toFixed(4)),
        createdAt: new Date(row.created_at).toISOString()
      };
    });

    return {
      success: true,
      data: {
        summary: {
          totalAiRequests: totalAiReqs,
          totalDbRequests: totalDbReqs,
          totalRequests: totalAiReqs + totalDbReqs,
          totalInputTokens,
          totalOutputTokens,
          totalTokens,
          totalCostUsd: Number(totalAiCostUsd.toFixed(4)),
          totalCostInr: Number(totalAiCostInr.toFixed(2)),
          activeApiKeys,
          paygUnbilledAmountInr: Number(paygUnbilledInr.toFixed(2)),
          cycleStart,
          cycleEnd
        },
        modelBreakdown,
        modalityBreakdown,
        ledger,
        projects
      }
    };
  } catch (err: any) {
    logger.error('[API Bills] Failed to fetch API bills data:', err);
    return { success: false, error: err?.message || 'Failed to load API bills' };
  }
}
