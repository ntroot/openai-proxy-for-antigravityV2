/**
 * Models route - Lists available models (dynamically fetched from Antigravity API)
 * GET /v1/models
 */

import type { FastifyInstance } from 'fastify';
import type { ProxyModelDefinition } from '../lib/models.js';
import { modelService } from '../services/model-service.js';

function toOpenAIModel(model: ProxyModelDefinition) {
  return {
    id: model.id,
    object: model.object,
    created: model.created,
    owned_by: model.owned_by,
  };
}

export default async function modelsRoutes(server: FastifyInstance) {
  server.get('/models', async () => {
    const catalog = await modelService.getCatalogModels();
    return {
      object: 'list',
      data: catalog.models.map(toOpenAIModel),
    };
  });

  server.get('/models/:model', async (request: any) => {
    const catalog = await modelService.getCatalogModels();
    const model = catalog.models.find((m) => m.id === request.params.model);

    if (!model) {
      return {
        error: {
          message: 'Model not found',
          type: 'invalid_request_error',
        },
      };
    }

    return toOpenAIModel(model);
  });
}
