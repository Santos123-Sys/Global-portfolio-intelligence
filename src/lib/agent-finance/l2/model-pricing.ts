/** Prices are operator-supplied per-million-token rates, never guessed from a model name. */
export function estimateModelCost(model:string,input:number|null,output:number|null):number|null {
  if(input===null || output===null || !process.env.AGENT_MODEL_PRICING_JSON)return null;
  try {
    const prices=JSON.parse(process.env.AGENT_MODEL_PRICING_JSON) as Record<string,{input:number;output:number}>;
    const rate=prices[model];
    if(!rate || !Number.isFinite(rate.input)||!Number.isFinite(rate.output)||rate.input<0||rate.output<0)return null;
    return (input*rate.input+output*rate.output)/1_000_000;
  }catch{return null;}
}
