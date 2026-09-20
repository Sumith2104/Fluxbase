/**
 * OpenAPI 3.0 specification generator for Fluxbase API.
 */

export function generateOpenAPISpec(): Record<string, any> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fluxbasedb.me';

    const unauthorized = {
        description: 'Unauthorized',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
    const forbidden = {
        description: 'Forbidden',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
    const notFound = {
        description: 'Not Found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
    const serverError = {
        description: 'Internal Server Error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };

    return {
        openapi: '3.0.3',
        info: {
            title: 'Fluxbase API',
            version: '0.1.0',
            description: 'Multi-tenant serverless SQL platform API',
        },
        servers: [{ url: baseUrl, description: 'Fluxbase API' }],
        components: {
            securitySchemes: {
                bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
                apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        error: {
                            type: 'object',
                            properties: {
                                message: { type: 'string' },
                                code: { type: 'string' },
                            },
                        },
                    },
                },
            },
            responses: { unauthorized, forbidden, notFound, serverError },
        },
        paths: {
            '/api/v1/models': {
                get: {
                    summary: 'List available Flux AI models',
                    tags: ['Flux AI'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    responses: {
                        '200': {
                            description: 'OpenAI-compatible list of available Flux AI models (flux, flux-flash, flux-pro, flux-ultra, flux-5.2)',
                        },
                        '401': unauthorized,
                    },
                },
            },
            '/api/v1/chat/completions': {
                post: {
                    summary: 'Generate chat completions with Flux AI models',
                    tags: ['Flux AI'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['messages'],
                                    properties: {
                                        model: {
                                            type: 'string',
                                            default: 'flux',
                                            enum: ['flux', 'flux-flash', 'flux-pro', 'flux-ultra', 'flux-5.2', 'gpt-4o', 'gpt-3.5-turbo'],
                                            description: 'Model identifier to use for completion'
                                        },
                                        messages: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['role', 'content'],
                                                properties: {
                                                    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                                                    content: { type: 'string' }
                                                }
                                            }
                                        },
                                        stream: { type: 'boolean', default: false, description: 'Whether to stream Server-Sent Events (SSE)' },
                                        temperature: { type: 'number', minimum: 0, maximum: 2 },
                                        max_tokens: { type: 'integer' }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        '200': { description: 'Chat completion response (or event-stream if stream=true)' },
                        '401': unauthorized,
                        '403': forbidden,
                        '429': { description: 'Rate limit exceeded (60 req/min)' },
                        '500': serverError,
                    },
                },
            },
            '/api/v1/sql': {
                post: {
                    summary: 'Execute SQL Query (v1 REST API)',
                    tags: ['SQL'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: { 'application/json': { schema: { type: 'object', required: ['projectId', 'query'], properties: { projectId: { type: 'string' }, query: { type: 'string' }, params: { type: 'array', items: {} } } } } },
                    },
                    responses: { '200': { description: 'Query result' }, '401': unauthorized, '500': serverError },
                },
            },
            '/api/execute-sql': {
                post: {
                    summary: 'Execute SQL',
                    tags: ['SQL'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: { 'application/json': { schema: { type: 'object', required: ['projectId', 'sql'], properties: { projectId: { type: 'string' }, sql: { type: 'string' }, params: { type: 'array', items: {} } } } } },
                    },
                    responses: { '200': { description: 'Query result' }, '401': unauthorized, '500': serverError },
                },
            },
            '/api/v1/rest/{projectId}/{table}': {
                get: {
                    summary: 'List rows',
                    tags: ['REST'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    parameters: [
                        { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'table', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                        { name: 'order_by', in: 'query', schema: { type: 'string' } },
                        { name: 'order_dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
                    ],
                    responses: { '200': { description: 'Paginated rows' }, '401': unauthorized },
                },
                post: {
                    summary: 'Insert row',
                    tags: ['REST'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    parameters: [
                        { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'table', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
                    responses: { '201': { description: 'Created row' }, '401': unauthorized, '403': forbidden },
                },
                put: {
                    summary: 'Update row',
                    tags: ['REST'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    parameters: [
                        { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'table', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
                    responses: { '200': { description: 'Updated row' }, '401': unauthorized, '403': forbidden, '404': notFound },
                },
                delete: {
                    summary: 'Delete row',
                    tags: ['REST'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    parameters: [
                        { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'table', in: 'path', required: true, schema: { type: 'string' } },
                        { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                    ],
                    responses: { '200': { description: 'Deleted' }, '401': unauthorized, '403': forbidden },
                },
            },
            '/api/auth/refresh': {
                post: {
                    summary: 'Refresh access token',
                    tags: ['Auth'],
                    responses: { '200': { description: 'New access token' }, '401': { description: 'Invalid or expired refresh token' } },
                },
            },
            '/api/fast-insert': {
                post: {
                    summary: 'Fast bulk insert',
                    tags: ['SQL'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
                    responses: { '200': { description: 'Insert result' }, '401': unauthorized },
                },
            },
            '/api/schema': {
                get: {
                    summary: 'Get project schema',
                    tags: ['Schema'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    parameters: [{ name: 'projectId', in: 'query', required: true, schema: { type: 'string' } }],
                    responses: { '200': { description: 'Schema info' }, '401': unauthorized },
                },
            },
            '/api/metrics': {
                get: {
                    summary: 'Prometheus metrics',
                    tags: ['System'],
                    responses: { '200': { description: 'Prometheus text format' } },
                },
            },
            '/api/docs': {
                get: {
                    summary: 'OpenAPI specification',
                    tags: ['System'],
                    responses: { '200': { description: 'OpenAPI 3.0 JSON' } },
                },
            },
        },
    };
}
