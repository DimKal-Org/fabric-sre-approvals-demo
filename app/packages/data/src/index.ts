import { Recommendation } from './Recommendation.js';

export { Recommendation };
export type AppSchema = { Recommendation: Recommendation };
export type { UniversalAppSchema } from '@rayfin-app/shared';

export const schema = [Recommendation];
