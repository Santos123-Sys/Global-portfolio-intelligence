import type { DiscoveredDocument, DocumentDiscoveryAgent } from '../types';
import { discoverBrFilings } from './cvm-dfp';
import { discoverGenericFilings } from './generic';
import { discoverUsFilings } from './sec-edgar';

export class MarketAdaptiveDiscovery implements DocumentDiscoveryAgent {
  async discover(ticker: string, exchange: string, country: string): Promise<DiscoveredDocument[]> {
    if (['XNAS', 'XNYS', 'ARCX'].includes(exchange) || /united states|usa|us/i.test(country)) return discoverUsFilings(ticker);
    if (exchange === 'BVMF' || /brazil|brasil/i.test(country)) return discoverBrFilings(ticker);
    return discoverGenericFilings(ticker, exchange);
  }
}
