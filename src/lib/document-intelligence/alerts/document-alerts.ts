import { db } from '../../db';
import { alerts } from '../../db/schema';
export async function createDocumentAlert(input: { ownerId: string; securityId: string; headline: string; detail?: string; severity?: 'info' | 'watch' | 'breach' }) { await db.insert(alerts).values({ ownerId: input.ownerId, securityId: input.securityId, alertType: 'market', severity: input.severity ?? 'info', headline: input.headline, detail: input.detail }); }
