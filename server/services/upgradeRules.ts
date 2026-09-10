export const REG32_MAX_PERIOD_MS=184*86_400_000;
export const REQUIRED_REG32_AUDIENCES=["young_person","placing_authority","staff","professional"] as const;
export function qualityPeriodError(start:number,end:number){if(end<=start)return"Review period end must be after its start";if(end-start>REG32_MAX_PERIOD_MS)return"A Regulation 32 review period must be no longer than six months";return null;}
export function missingReviewAudiences(rows:Array<{audience:string;responseStatus:string}>){const completed=new Set(rows.filter(row=>["responded","declined","no_response","not_applicable"].includes(row.responseStatus)).map(row=>row.audience));return REQUIRED_REG32_AUDIENCES.filter(audience=>!completed.has(audience));}
export function independentReviewAllowed(actorId:number,authors:Array<number|null|undefined>){return!authors.some(author=>author===actorId);}
export function workedMinutes(start:number,end:number){return Math.max(0,Math.round((end-start)/60_000));}
