import { UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { DecisionResult, UniversalAppSchema } from '@rayfin-app/shared';
import { decideRecommendation } from './decisions.js';

const udf = new UserDataFunctions();

// The 1.36.2 host needs a default initializer to accept an omitted parameter.
udf.func('approveRecommendation', async (
  ctx: RayfinContext<UniversalAppSchema>, id: string, comment: string | undefined = undefined,
): Promise<DecisionResult> => decideRecommendation(ctx, id, comment, 'Approved'), []);

udf.func('rejectRecommendation', async (
  ctx: RayfinContext<UniversalAppSchema>, id: string, comment: string | undefined = undefined,
): Promise<DecisionResult> => decideRecommendation(ctx, id, comment, 'Rejected'), []);
