export function healthEscalationRequired(outcome:string,requested=false){return requested||outcome==="outside_expected";}
export function medicationEscalationRequired(outcome:string,requested=false){return requested||["refused","omitted","unavailable"].includes(outcome);}
export function curfewEscalationRequired(status:string,requested=false){return requested||status==="absent";}
export function canManagerAcknowledgeMedication(role:string,creatorId:number|null|undefined,actorId:number){return["owner","registered_manager"].includes(role)&&creatorId!==actorId;}
export function scheduledActivityNeedsAcknowledgement(required:number|boolean,acknowledgedAt:number|null|undefined){return Boolean(required)&&!acknowledgedAt;}
