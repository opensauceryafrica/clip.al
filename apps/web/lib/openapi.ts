import 'server-only';
import { getPublicBaseUrl } from '@clipal/config';

/**
 * The clip.al public REST API specification (OpenAPI 3.1), authored as a typed
 * object so it is the SINGLE source of truth: the JSON route serves it verbatim
 * and the hand-rolled `/docs/api` reader renders it. (`openapi.yaml` in the app
 * root is a checked-in mirror for distribution; this object is canonical.)
 *
 * `servers[0].url` is derived from APP_URL at request time, never the Host
 * header — see `buildOpenApiSpec`.
 */

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'unauthorized',
            'forbidden',
            'not_found',
            'rate_limited',
            'invalid_request',
            'plan_required',
          ],
        },
        message: { type: 'string' },
        details: {},
      },
    },
  },
} as const;

const linkSchema = {
  type: 'object',
  properties: {
    code: { type: 'string', example: 'abc1234' },
    shortUrl: { type: 'string', format: 'uri' },
    destinationUrl: { type: 'string', format: 'uri' },
    status: {
      type: 'string',
      enum: [
        'active',
        'disabled_by_user',
        'disabled_by_admin',
        'disabled_by_safety',
        'pending_review',
      ],
    },
    routingMode: { type: 'string', enum: ['single', 'geo', 'device', 'ab'] },
    customSlug: { type: 'boolean' },
    passwordProtected: { type: 'boolean' },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    maxClicks: { type: ['integer', 'null'] },
    clicksTotal: { type: 'integer' },
    lastClickAt: { type: ['string', 'null'], format: 'date-time' },
    campaignId: { type: ['string', 'null'], format: 'uuid' },
    safetyState: { type: 'string', enum: ['unchecked', 'clean', 'suspicious', 'malicious'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

const commonErrors = {
  '401': errorResponse('Missing or invalid API key.'),
  '403': errorResponse('The key lacks the required scope.'),
  '429': errorResponse('Rate or quota limit exceeded.'),
};

const cursorParams = [
  {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'Opaque pagination cursor returned as `pagination.nextCursor`.',
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Page size (max 100).',
  },
] as const;

const codeParam = {
  name: 'code',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'The short link back-half.',
} as const;

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description: 'Client-chosen key; replays the original response for 24h.',
} as const;

/** Build the full spec object, with the server URL resolved from APP_URL. */
export function buildOpenApiSpec(): Record<string, unknown> {
  const base = getPublicBaseUrl();
  return {
    openapi: '3.1.0',
    info: {
      title: 'clip.al API',
      version: '1.0.0',
      description:
        'The clip.al public REST API. Authenticate with a bearer API key. All ' +
        'errors share the envelope `{ "error": { "code", "message", "details?" } }`.',
    },
    servers: [{ url: `${base}/api/v1`, description: 'This instance' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Links', description: 'Create, list, read, update and delete links.' },
      { name: 'Analytics', description: 'Per-link click events and aggregates.' },
      { name: 'Utilities', description: 'QR codes and account info.' },
    ],
    paths: {
      '/links': {
        post: {
          tags: ['Links'],
          summary: 'Create a link',
          description: 'Scope: `links:write`. Accepts `Idempotency-Key`.',
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['destination'],
                  properties: {
                    destination: { type: 'string', format: 'uri', maxLength: 2048 },
                    customSlug: { type: 'string', minLength: 1, maxLength: 64 },
                    expiresAt: { type: 'string', format: 'date-time' },
                    maxClicks: { type: 'integer', minimum: 1 },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { link: { $ref: '#/components/schemas/Link' } },
                  },
                },
              },
            },
            '400': errorResponse('Invalid request body or slug.'),
            '402': errorResponse('A power option requires a higher plan.'),
            ...commonErrors,
          },
        },
        get: {
          tags: ['Links'],
          summary: 'List links',
          description: 'Scope: `links:read`. Cursor-paginated, most-recently-updated last.',
          parameters: [...cursorParams],
          responses: {
            '200': {
              description: 'A page of links.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Link' } },
                      pagination: {
                        type: 'object',
                        properties: {
                          nextCursor: { type: ['string', 'null'] },
                          hasMore: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
            ...commonErrors,
          },
        },
      },
      '/links/{code}': {
        get: {
          tags: ['Links'],
          summary: 'Get a link',
          description: 'Scope: `links:read`.',
          parameters: [codeParam],
          responses: {
            '200': {
              description: 'The link.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { link: { $ref: '#/components/schemas/Link' } },
                  },
                },
              },
            },
            '404': errorResponse('No such link owned by you.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Links'],
          summary: 'Update a link',
          description: 'Scope: `links:write`. Update destination, max clicks, or expiry.',
          parameters: [codeParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    destination: { type: 'string', format: 'uri', maxLength: 2048 },
                    maxClicks: { type: ['integer', 'null'], minimum: 1 },
                    expiresAt: { type: ['string', 'null'], format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The updated link.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { link: { $ref: '#/components/schemas/Link' } },
                  },
                },
              },
            },
            '400': errorResponse('Invalid request body.'),
            '404': errorResponse('No such link owned by you.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Links'],
          summary: 'Delete a link',
          description: 'Scope: `links:write`. Soft-deletes (status `disabled_by_user`).',
          parameters: [codeParam],
          responses: {
            '200': {
              description: 'Deleted.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      deleted: { type: 'boolean' },
                      code: { type: 'string' },
                    },
                  },
                },
              },
            },
            '404': errorResponse('No such link owned by you.'),
            ...commonErrors,
          },
        },
      },
      '/links/{code}/clicks': {
        get: {
          tags: ['Analytics'],
          summary: 'Recent click events',
          description: 'Scope: `analytics:read`. Capped to 90 days and your plan retention.',
          parameters: [
            codeParam,
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            },
          ],
          responses: {
            '200': {
              description: 'Recent clicks.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      code: { type: 'string' },
                      retentionDays: { type: 'integer' },
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '404': errorResponse('No such link owned by you.'),
            ...commonErrors,
          },
        },
      },
      '/links/{code}/stats': {
        get: {
          tags: ['Analytics'],
          summary: 'Aggregated stats',
          description:
            'Scope: `analytics:read`. Click totals for today/7d/30d plus top ' +
            'countries and referrers.',
          parameters: [codeParam],
          responses: {
            '200': {
              description: 'Aggregated stats.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      code: { type: 'string' },
                      clicksTotal: { type: 'integer' },
                      totals: {
                        type: 'object',
                        properties: {
                          today: { type: 'integer' },
                          last7d: { type: 'integer' },
                          last30d: { type: 'integer' },
                        },
                      },
                      byCountry: { type: 'array', items: { type: 'object' } },
                      byReferrer: { type: 'array', items: { type: 'object' } },
                      retentionDays: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '404': errorResponse('No such link owned by you.'),
            ...commonErrors,
          },
        },
      },
      '/qr': {
        post: {
          tags: ['Utilities'],
          summary: 'Generate a QR code',
          description:
            'Scope: `links:read`. Requires the `qr` plan capability. Returns the ' +
            'image base64-encoded inline. Accepts `Idempotency-Key`.',
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { type: 'string', format: 'uri' },
                    format: { type: 'string', enum: ['png', 'svg'], default: 'png' },
                    fg: {
                      type: 'string',
                      enum: ['mono', 'zinc', 'blue', 'green', 'amber'],
                      default: 'mono',
                    },
                    size: { type: 'integer', enum: [256, 512, 1024] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The rendered QR code.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      format: { type: 'string' },
                      contentType: { type: 'string' },
                      encoding: { type: 'string', enum: ['base64'] },
                      image: { type: 'string' },
                    },
                  },
                },
              },
            },
            '402': errorResponse('QR generation requires a higher plan.'),
            '400': errorResponse('Invalid request body.'),
            ...commonErrors,
          },
        },
      },
      '/me': {
        get: {
          tags: ['Utilities'],
          summary: 'Account and quota',
          description: 'Any valid key. Returns the account plan and current-month usage.',
          responses: {
            '200': {
              description: 'Account info and usage.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      user: { type: 'object' },
                      plan: { type: 'string' },
                      scopes: { type: 'array', items: { type: 'string' } },
                      usage: { type: 'object' },
                    },
                  },
                },
              },
            },
            '401': commonErrors['401'],
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'clpl_…',
          description: 'An API key minted in Settings → API keys.',
        },
      },
      schemas: {
        Error: errorEnvelope,
        Link: linkSchema,
      },
    },
  };
}
