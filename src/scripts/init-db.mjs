import 'dotenv/config'; // Loads .env.local by default if available, but let's be explicit
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env.local');

// 1. Manually load .env.local
if (fs.existsSync(envPath)) {
    console.log(`Loading environment from ${envPath}`);
    dotenv.config({ path: envPath });
} else {
    console.warn(`.env.local not found at ${envPath}, relying on system boundaries.`);
}

const connectionString = process.env.AWS_RDS_POSTGRES_URL;

if (!connectionString) {
    console.error("❌ ERROR: AWS_RDS_POSTGRES_URL is missing in environment variables.");
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function initDb() {
    console.log("🔌 Connecting to AWS RDS to provision Global Schemas...");
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log("🔨 Creating Schema: fluxbase_global");
        await client.query('CREATE SCHEMA IF NOT EXISTS fluxbase_global');

        console.log("🔨 Creating Table: fluxbase_global.users");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.users (
                id VARCHAR(128) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                display_name VARCHAR(255),
                photo_url TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Phase 1 Migration: Add Subscription Columns
        console.log("🔨 Migrating Table: fluxbase_global.users (Adding Subscription Columns)");
        await client.query(`
            ALTER TABLE fluxbase_global.users 
            ADD COLUMN IF NOT EXISTS razorpay_customer_id VARCHAR(255),
            ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(255),
            ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50) DEFAULT 'free',
            ADD COLUMN IF NOT EXISTS billing_cycle_end TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
        `);

        console.log("🔨 Creating Table: fluxbase_global.projects");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.projects (
                project_id VARCHAR(128) PRIMARY KEY,
                user_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.users(id) ON DELETE CASCADE,
                display_name VARCHAR(255) NOT NULL,
                dialect VARCHAR(50) DEFAULT 'mysql',
                timezone VARCHAR(100) DEFAULT 'UTC',
                ai_allow_destructive BOOLEAN DEFAULT false,
                ai_schema_inference BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Phase 2 Migration: Add AI Preferences Columns to projects table
        console.log("🔨 Migrating Table: fluxbase_global.projects (Adding AI Preference Columns)");
        await client.query(`
            ALTER TABLE fluxbase_global.projects 
            ADD COLUMN IF NOT EXISTS ai_allow_destructive BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS ai_schema_inference BOOLEAN DEFAULT true;
        `);

        // Phase 3 Migration: Add Resource Limits Constraints
        console.log("🔨 Migrating Table: fluxbase_global.projects (Adding Custom Resource Limits Columns)");
        await client.query(`
            ALTER TABLE fluxbase_global.projects
            ADD COLUMN IF NOT EXISTS custom_api_limit INTEGER,
            ADD COLUMN IF NOT EXISTS custom_row_limit INTEGER,
            ADD COLUMN IF NOT EXISTS custom_request_limit INTEGER,
            ADD COLUMN IF NOT EXISTS alert_email VARCHAR(255),
            ADD COLUMN IF NOT EXISTS alert_threshold_percent INTEGER DEFAULT 80,
            ADD COLUMN IF NOT EXISTS last_api_alert_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS last_row_alert_at TIMESTAMP WITH TIME ZONE;
        `);

        console.log("🔨 Creating Table: fluxbase_global.api_keys");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.api_keys (
                id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                project_id VARCHAR(128),
                project_name VARCHAR(255),
                preview VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP WITH TIME ZONE
            )
        `);

        console.log("🔨 Creating Table: fluxbase_global.webhooks");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.webhooks (
                webhook_id VARCHAR(128) PRIMARY KEY,
                project_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.projects(project_id) ON DELETE CASCADE,
                user_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                url TEXT NOT NULL,
                event VARCHAR(50) NOT NULL,
                table_id VARCHAR(255) NOT NULL,
                secret VARCHAR(255),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("🔨 Creating Table: fluxbase_global.analytics_rollups");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.analytics_rollups (
                project_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.projects(project_id) ON DELETE CASCADE,
                period_start TIMESTAMP WITH TIME ZONE NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                count INTEGER DEFAULT 1,
                PRIMARY KEY (project_id, period_start, event_type)
            )
        `);

        console.log("🔨 Creating Table: fluxbase_global.login_history");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.login_history (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.users(id) ON DELETE CASCADE,
                email VARCHAR(255) NOT NULL,
                ip VARCHAR(45) NOT NULL,
                user_agent TEXT NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("🔨 Creating Table: fluxbase_global.storage_buckets");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.storage_buckets (
                id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                project_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.projects(project_id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                is_public BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (project_id, name)
            )
        `);

        console.log("🔨 Creating Table: fluxbase_global.storage_objects");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.storage_objects (
                id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                bucket_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.storage_buckets(id) ON DELETE CASCADE,
                project_id VARCHAR(128) NOT NULL REFERENCES fluxbase_global.projects(project_id) ON DELETE CASCADE,
                name VARCHAR(1024) NOT NULL,
                s3_key TEXT NOT NULL UNIQUE,
                size BIGINT NOT NULL DEFAULT 0,
                mime_type VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Phase 4: Flux Hosting Infrastructure Tables
        console.log("🔨 Creating Table: fluxbase_global.hosting_sites");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.hosting_sites (
                site_id         VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                project_id      VARCHAR(128) NOT NULL REFERENCES fluxbase_global.projects(project_id) ON DELETE CASCADE,
                user_id         VARCHAR(128) NOT NULL REFERENCES fluxbase_global.users(id) ON DELETE CASCADE,

                subdomain       VARCHAR(63) UNIQUE NOT NULL,
                custom_domain   VARCHAR(255) UNIQUE,
                custom_domain_verified BOOLEAN DEFAULT false,

                production_deploy_id VARCHAR(128),
                preview_deploy_id    VARCHAR(128),

                is_spa          BOOLEAN DEFAULT true,
                framework       VARCHAR(50) DEFAULT 'static',
                root_directory  VARCHAR(255) DEFAULT '/',
                not_found_page  VARCHAR(255) DEFAULT '/404.html',

                github_repo     VARCHAR(255),
                github_branch   VARCHAR(100) DEFAULT 'main',
                github_build_dir VARCHAR(255) DEFAULT 'dist',
                auto_deploy     BOOLEAN DEFAULT true,
                github_webhook_id BIGINT,

                ai_models_enabled BOOLEAN DEFAULT false,
                ai_models_quota   INTEGER DEFAULT 1000,

                status          VARCHAR(20) DEFAULT 'active',
                created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

                UNIQUE (project_id)
            );

            CREATE INDEX IF NOT EXISTS idx_hosting_sites_subdomain ON fluxbase_global.hosting_sites(subdomain);
            CREATE INDEX IF NOT EXISTS idx_hosting_sites_custom_domain ON fluxbase_global.hosting_sites(custom_domain) WHERE custom_domain IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_hosting_sites_user ON fluxbase_global.hosting_sites(user_id);
        `);

        console.log("🔨 Creating Table: fluxbase_global.hosting_deployments");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.hosting_deployments (
                deploy_id       VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                site_id         VARCHAR(128) NOT NULL REFERENCES fluxbase_global.hosting_sites(site_id) ON DELETE CASCADE,
                project_id      VARCHAR(128) NOT NULL,
                user_id         VARCHAR(128) NOT NULL,

                environment     VARCHAR(20) NOT NULL DEFAULT 'preview',
                version         INTEGER NOT NULL DEFAULT 1,
                commit_sha      VARCHAR(40),
                commit_message  TEXT,
                branch          VARCHAR(100),
                source          VARCHAR(20) NOT NULL DEFAULT 'upload',

                s3_prefix       TEXT NOT NULL,
                file_count      INTEGER DEFAULT 0,
                total_size_bytes BIGINT DEFAULT 0,
                entry_file      VARCHAR(255) DEFAULT 'index.html',

                status          VARCHAR(20) DEFAULT 'uploading',
                error_message   TEXT,

                build_log_key   TEXT,

                created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                deployed_at     TIMESTAMPTZ,
                superseded_at   TIMESTAMPTZ,

                preview_url     TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_hosting_deploys_site ON fluxbase_global.hosting_deployments(site_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_hosting_deploys_status ON fluxbase_global.hosting_deployments(status);
        `);

        console.log("🔨 Creating Table: fluxbase_global.hosting_env_vars");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.hosting_env_vars (
                id              VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                site_id         VARCHAR(128) NOT NULL REFERENCES fluxbase_global.hosting_sites(site_id) ON DELETE CASCADE,
                environment     VARCHAR(20) NOT NULL DEFAULT 'production',
                key             VARCHAR(255) NOT NULL,
                value           TEXT NOT NULL,
                is_secret       BOOLEAN DEFAULT false,
                created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

                UNIQUE (site_id, environment, key)
            );
        `);

        console.log("🔨 Creating Table: fluxbase_global.hosting_access_logs");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.hosting_access_logs (
                id              BIGSERIAL PRIMARY KEY,
                site_id         VARCHAR(128) NOT NULL,
                deploy_id       VARCHAR(128),
                path            VARCHAR(2048),
                status_code     SMALLINT,
                bytes_served    BIGINT DEFAULT 0,
                ip              VARCHAR(45),
                user_agent      TEXT,
                referer         TEXT,
                country         VARCHAR(2),
                created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_hosting_access_site ON fluxbase_global.hosting_access_logs(site_id, created_at DESC);
        `);

        console.log("🔨 Creating Table: fluxbase_global.hosting_domain_verifications");
        await client.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.hosting_domain_verifications (
                id              VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
                site_id         VARCHAR(128) NOT NULL REFERENCES fluxbase_global.hosting_sites(site_id) ON DELETE CASCADE,
                domain          VARCHAR(255) NOT NULL,
                verification_type VARCHAR(20) DEFAULT 'CNAME',
                verification_key  VARCHAR(255) NOT NULL,
                verification_value VARCHAR(255) NOT NULL,
                verified        BOOLEAN DEFAULT false,
                last_check_at   TIMESTAMPTZ,
                created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log("✅ SUCCESS: Global Schemas and Metadata Tables Provisioned.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR failed to provision schemas:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

initDb();
