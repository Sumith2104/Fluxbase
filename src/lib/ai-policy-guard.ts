/**
 * Fluxbase AI Scope Policy Guard
 * 
 * Enforces strict restriction of Fluxbase AI to 4 Core Pillars:
 * 1. Fluxbase Operations (tables, schema DDL, columns, storage, webhooks, API keys, settings)
 * 2. Query (writing, optimizing, explaining, diagnosing, and executing SQL, visual charts)
 * 3. Navigation (in-app page navigation, UI clicking, form typing)
 * 4. Automation Tasks (Auto-Pilot workflows, data seeding with generate_series, triggers, scraper ingestion)
 * 
 * Explicitly rejects:
 * - Plant/crop/leaf disease identification and agricultural diagnosis
 * - General standalone Python code (ML models, OpenCV, classifiers, general apps)
 * - Non-database image analysis (leaves, plants, crops, animals, general photos)
 * - General off-topic tasks (creative writing, recipes, trivia)
 */

export interface PolicyCheckResult {
    isOffTopic: boolean;
    reason?: 'leaf_or_plant_disease_diagnosis' | 'standalone_python_or_ml_request' | 'non_database_image_upload' | 'general_off_topic';
    refusalText?: string;
}

export const FLUXBASE_SCOPE_REFUSAL = `I am Flux AI, the specialized Database Architect and Developer Assistant strictly dedicated to **Fluxbase** (https://fluxbasedb.me).

I am strictly confined to the following 4 core categories:
1. **Fluxbase Operations**: Table management, schema DDL, columns, foreign keys, indexes, S3 storage, webhooks, API keys, and project settings.
2. **Query**: Writing, optimizing, diagnosing, and executing PostgreSQL/MySQL queries (\`[EXECUTE_SQL:...]\`), and generating visual analytics charts (\`[RENDER_CHART:...]\`).
3. **Navigation**: Teleporting to dashboard pages (\`[NAVIGATE:...]\`), clicking UI buttons (\`[CLICK:...]\`), and typing form inputs (\`[TYPE:...]\`).
4. **Automation Tasks**: Auto-Pilot multi-step database workflows, bulk mock data generation via \`generate_series\`, table triggers, and web scraper ingestion into database tables.

> **Scope Restriction**: I cannot analyze photos of leaves/plants, diagnose agricultural diseases, or generate standalone Python machine learning / general application scripts.

Please let me know how I can assist you with your **Fluxbase database, SQL queries, dashboard navigation, or workspace automation**!`;

export const PYTHON_CODE_REFUSAL = `I am Flux AI, strictly dedicated to Fluxbase database management, SQL queries, UI navigation, and workspace automation.

I cannot generate standalone Python machine learning models, image classification scripts, OpenCV code, or general non-database software. The only Python snippets I can provide are:
- Connecting to your Fluxbase database via \`psycopg2\`, \`asyncpg\`, or \`SQLAlchemy\`
- Calling Fluxbase REST SQL, Storage, or Realtime APIs

If you need to connect your application to Fluxbase or manage tables and queries, let me know and I will gladly provide the database schema and connection code!`;

export const NON_DB_IMAGE_REFUSAL = `I am Flux AI, strictly dedicated to Fluxbase database management, SQL queries, UI navigation, and workspace automation.

I cannot analyze photos of leaves, plants, crops, or non-database media. Multimodal image analysis is strictly reserved for:
- Database Entity-Relationship Diagrams (ERDs) and schema blueprints
- SQL error dialogs and terminal execution stack traces
- Fluxbase dashboard UI screenshots

Please upload a database ER diagram, schema sketch, or SQL error screenshot, and I will be happy to assist!`;

export const GENERAL_OFF_TOPIC_REFUSAL = `I am Flux AI, the specialized database architect and developer assistant for Fluxbase (https://fluxbasedb.me). I can only assist with Fluxbase platform operations, database queries, SQL architecture, storage, webhooks, and workspace automation. How can I help you with your Fluxbase workspace today?`;

export function checkOffTopicPolicy(userText: string, hasAttachedImages: boolean = false): PolicyCheckResult {
    const text = (userText || '').trim().toLowerCase();
    if (!text && !hasAttachedImages) {
        return { isOffTopic: false };
    }

    // ── Safe Exceptions (Database Operations & Fluxbase Connection Requests) ──
    const isExplicitDbOperation = /\b(?:create\s+table|alter\s+table|drop\s+table|truncate\s+table|add\s+column|select\s+[\s\S]*\s+from|insert\s+into|update\s+[\s\S]*\s+set|delete\s+from|create\s+index|generate_series|information_schema|pg_catalog|explain\s+analyze)\b/i.test(text);
    const isFluxbaseConnection = /\b(?:connect(?:ion)?|uri|sdk|client|api\s*key|database_url|psycopg|asyncpg|sqlalchemy|prisma|drizzle)\b/i.test(text) && /\b(?:fluxbase|postgres|postgresql|mysql|database|db|tenant)\b/i.test(text);

    // ── 1. Plant / Leaf / Crop Disease Detection & Agricultural Diagnosis ──
    const hasPlantOrLeafTerms = /\b(?:leaf|leaves|plant|plants|crop|crops|tomato|potato|wheat|rice|maize|corn|grape|citrus|cotton|foliage|botanical|botany|agriculture|farming|paddy|farm|seedling|vegetable|orchard)\b/i.test(text);
    const hasDiseaseOrHealthTerms = /\b(?:disease|diseases|infection|infections|blight|mildew|rust|rot|wilt|canker|spot|spots|pest|pests|fungus|fungal|chlorosis|deficiency|pathogen|pesticide|fungicide|fertilizer|cure|diagnos(?:e|is)|symptom|symptoms|healthy|sick|unhealthy|yellowing|lesion|lesions)\b/i.test(text);
    const isDiagnosingIntent = /\b(?:diagnos|identify|detect|inspect|examine|check|see|classify)\b/i.test(text) && (hasPlantOrLeafTerms || hasDiseaseOrHealthTerms);

    if (!isExplicitDbOperation && !isFluxbaseConnection) {
        if ((hasPlantOrLeafTerms && hasDiseaseOrHealthTerms) || isDiagnosingIntent) {
            return {
                isOffTopic: true,
                reason: 'leaf_or_plant_disease_diagnosis',
                refusalText: FLUXBASE_SCOPE_REFUSAL
            };
        }

        // Attached image with plant/leaf terms or general "look at this" prompt
        if (hasAttachedImages && (hasPlantOrLeafTerms || hasDiseaseOrHealthTerms || /\b(?:photo|picture|look\s+at|what\s+is\s+this|what\s+kind\s+of|analyze\s+this)\b/i.test(text))) {
            return {
                isOffTopic: true,
                reason: 'non_database_image_upload',
                refusalText: NON_DB_IMAGE_REFUSAL
            };
        }

        // ── 2. Standalone Python / Machine Learning / Image Processing Scripts ──
        const isGeneralPythonOrMl = /\b(?:python\s+(?:code|script|program|app|function|file)|pytorch|tensorflow|keras|opencv|cv2|scikit|yolo|cnn|resnet|image\s+classification|object\s+detection|machine\s+learning\s+model|train\s+(?:a\s+)?model)\b/i.test(text);
        const isAskingToWriteGeneralCode = /\b(?:write|create|generate|give\s+me|provide|show\s+me|code\s+for|script\s+for)\b/i.test(text) && isGeneralPythonOrMl;

        if (isAskingToWriteGeneralCode && !isFluxbaseConnection) {
            return {
                isOffTopic: true,
                reason: 'standalone_python_or_ml_request',
                refusalText: PYTHON_CODE_REFUSAL
            };
        }

        // ── 3. Unrelated General Off-Topic ──
        const isGeneralOffTopic = /\b(?:write\s+(?:a\s+)?(?:poem|song|story|essay|joke|recipe|novel)|weather\s+in|who\s+won\s+the|sports\s+score|horoscope)\b/i.test(text);
        if (isGeneralOffTopic) {
            return {
                isOffTopic: true,
                reason: 'general_off_topic',
                refusalText: GENERAL_OFF_TOPIC_REFUSAL
            };
        }
    }

    return { isOffTopic: false };
}
