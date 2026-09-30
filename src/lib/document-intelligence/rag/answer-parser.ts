export function validateAnswerCitations(answer: string, citationCount: number): string {
  const references = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (!references.length && !answer.includes('I cannot find information about this in the available documents.')) throw new Error('Gemini answer contains no citations');
  if (references.some((reference) => reference < 1 || reference > citationCount)) throw new Error('Gemini answer cites an excerpt that was not retrieved');
  return answer;
}
