/** Human quality ratings are not realized-return outcomes or probability calibration. */
export function confidenceReviewSummary(rows:Array<{finalOutput:unknown;accuracyScore:string|null}>) {
  const bins=[{label:'0–39',min:0,max:39},{label:'40–59',min:40,max:59},{label:'60–74',min:60,max:74},{label:'75–89',min:75,max:89},{label:'90–100',min:90,max:100}];
  return bins.map(bin=>{
    const pairs=rows.flatMap(row=>{
      const confidence=(row.finalOutput as {confidenceScore?:unknown}|null)?.confidenceScore;
      const review=row.accuracyScore===null ? NaN : Number(row.accuracyScore);
      return typeof confidence==='number' && Number.isFinite(confidence) && Number.isFinite(review) && confidence>=bin.min && confidence<=bin.max ? [{confidence,review}] : [];
    });
    return {band:bin.label,samples:pairs.length,meanConfidence:pairs.length ? pairs.reduce((n,p)=>n+p.confidence,0)/pairs.length : null,meanHumanRating:pairs.length ? pairs.reduce((n,p)=>n+p.review,0)/pairs.length : null};
  });
}
