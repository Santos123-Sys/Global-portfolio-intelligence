/** Only bounded internal codes may enter startup logs; never log provider bodies or URLs. */
export function historyEvidenceError(error:unknown){
 return error instanceof Error&&/^history_(secondary|brazil)_[a-z_0-9]{1,80}$/.test(error.message)?error.message:'secondary_invalid';
}
