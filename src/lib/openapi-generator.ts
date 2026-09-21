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
                    summary: 'List available Flux AI models across all modalities',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    responses: {
                        '200': {
                            description: 'OpenAI-compatible list of available Flux AI models across text, image, audio, video, and embedding modalities',
                        },
                        '401': unauthorized,
                    },
                },
            },
            '/api/v1/chat/completions': {
                post: {
                    summary: 'Generate chat completions with Flux AI reasoning models',
                    tags: ['Flux AI Multimodal'],
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
                                            default: 'flux-fast',
                                            enum: ['flux-fast', 'flux-pro', 'flux-ultra', 'flux-turbo', 'flux-omni', 'flux-max', 'gpt-4o', 'gpt-3.5-turbo'],
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
                        '429': { description: 'Rate limit exceeded' },
                        '500': serverError,
                    },
                },
            },
            '/api/v1/images/generations': {
                post: {
                    summary: 'Generate photorealistic images with Flux Image models',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['prompt'],
                                    properties: {
                                        model: { type: 'string', default: 'flux-image', enum: ['flux-image', 'flux-image-fast', 'flux-image-hd', 'flux-image-pro', 'dall-e-3'] },
                                        prompt: { type: 'string', description: 'Text prompt describing the desired image' },
                                        n: { type: 'integer', default: 1, minimum: 1, maximum: 4 },
                                        size: { type: 'string', default: '1024x1024' },
                                        response_format: { type: 'string', default: 'url', enum: ['url', 'b64_json'] }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        '200': { description: 'OpenAI-compatible image generation result with durable S3 URLs' },
                        '401': unauthorized,
                        '429': { description: 'Rate limit exceeded' },
                        '500': serverError,
                    }
                }
            },
            '/api/v1/audio/transcriptions': {
                post: {
                    summary: 'Transcribe audio to text with Flux Listen models',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'multipart/form-data': {
                                schema: {
                                    type: 'object',
                                    required: ['file'],
                                    properties: {
                                        file: { type: 'string', format: 'binary', description: 'Audio file (mp3, wav, m4a, ogg, webm, mp4)' },
                                        model: { type: 'string', default: 'flux-listen', enum: ['flux-listen', 'flux-listen-pro', 'flux-listen-en', 'whisper-1'] },
                                        language: { type: 'string', description: 'ISO language code' },
                                        response_format: { type: 'string', default: 'json', enum: ['json', 'text', 'verbose_json'] }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        '200': { description: 'Audio transcription response' },
                        '401': unauthorized,
                        '429': { description: 'Rate limit exceeded' },
                        '500': serverError,
                    }
                }
            },
            '/api/v1/audio/speech': {
                post: {
                    summary: 'Synthesize speech from text with Flux Speak models',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['input', 'voice'],
                                    properties: {
                                        model: { type: 'string', default: 'flux-speak', enum: ['flux-speak', 'flux-speak-hd', 'tts-1'] },
                                        input: { type: 'string', description: 'The text to generate audio for' },
                                        voice: { type: 'string', default: 'alloy', enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
                                        response_format: { type: 'string', default: 'mp3', enum: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] },
                                        speed: { type: 'number', default: 1.0, minimum: 0.25, maximum: 4.0 }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        '200': { description: 'Binary audio stream (audio/mpeg, etc.)' },
                        '401': unauthorized,
                        '429': { description: 'Rate limit exceeded' },
                        '500': serverError,
                    }
                }
            },
            '/api/v1/videos/generations': {
                post: {
                    summary: 'Dispatch async video generation with Flux Video models',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['prompt'],
                                    properties: {
                                        model: { type: 'string', default: 'flux-video', enum: ['flux-video', 'flux-video-pro'] },
                                        prompt: { type: 'string', description: 'Text prompt describing the desired video motion' },
                                        image_url: { type: 'string', description: 'Optional source image for image-to-video synthesis' }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        '202': { description: 'Task accepted for processing with task_id and poll_url' },
                        '401': unauthorized,
                        '429': { description: 'Rate limit exceeded' },
                        '500': serverError,
                    }
                }
            },
            '/api/v1/videos/generations/{taskId}': {
                get: {
                    summary: 'Poll status and retrieve generated video URL',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    parameters: [
                        { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }
                    ],
                    responses: {
                        '200': { description: 'Video generation status and final S3 video URL upon completion' },
                        '401': unauthorized,
                        '404': notFound,
                        '500': serverError,
                    }
                }
            },
            '/api/v1/embeddings': {
                post: {
                    summary: 'Generate high-performance 768-dimensional text embeddings',
                    tags: ['Flux AI Multimodal'],
                    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['input'],
                                    properties: {
                                        model: { type: 'string', default: 'flux-embed', enum: ['flux-embed', 'text-embedding-3-small'] },
                                        input: {
                                            oneOf: [
                                                { type: 'string' },
                                                { type: 'array', items: { type: 'string' } }
                                            ],
                                            description: 'Input text or array of strings to embed'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        '200': { description: 'OpenAI-compatible embedding vectors' },
                        '401': unauthorized,
                        '429': { description: 'Rate limit exceeded' },
                        '500': serverError,
                    }
                }
            },
            '/api/v1/media/{mediaId}': {
                get: {
                    summary: 'Securely retrieve generated multimodal media asset via presigned redirect',
                    tags: ['Flux AI Multimodal'],
                    parameters: [
                        { name: 'mediaId', in: 'path', required: true, schema: { type: 'string' } }
                    ],
                    responses: {
                        '302': { description: 'Redirect to secure private S3 presigned asset URL' },
                        '404': notFound,
                        '410': { description: 'Asset expired' },
                        '500': serverError,
                    }
                }
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
