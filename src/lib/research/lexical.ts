/** Shared bounded lexical policy for corpus retrieval and secondary evidence tools. */
export const lexicalTokens=(text:string):string[]=>text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[];
const stopwords=new Set('a an and are as at be by do does for from how in is it of on or that the their this to was were what when where which who why with would about has have had not can de da das do dos e em o os as um uma por para com que qual quais como sao se na no nas nos ao aos'.split(' '));
export const queryTerms=(text:string)=>[...new Set(lexicalTokens(text).filter(term=>!stopwords.has(term)))].slice(0,32);
