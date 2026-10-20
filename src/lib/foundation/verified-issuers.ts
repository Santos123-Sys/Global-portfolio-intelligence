import seed from '../../../data/usa-cvm-universe.json';
import proof from '../../../data/brazil-issuer-proof.json';
import type {Candidate} from './contracts';
/** Backfill only exact legacy starter records. Never replace a user-supplied identity. */
export function verifiedStarterIdentity(candidate:Candidate):Candidate {
 if(candidate.issuer||candidate.market!=='br')return candidate;
 const original=seed.candidates.find(c=>c.key===candidate.key),record=proof.mappings.find(p=>p.candidateKey===candidate.key);
 if(!original?.issuer||!record||candidate.name!==original.name||candidate.identitySourceUrl!==record.listingSourceUrl)return candidate;
 return {...candidate,issuer:{jurisdiction:'br',registryId:record.cnpj},identitySourceUrl:record.registrySourceUrl};
}
