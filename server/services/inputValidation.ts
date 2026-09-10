import {TRPCError} from "@trpc/server";

export type ValidationIssue={field:string;message:string;overrideAvailable:boolean};

export function dateRangeIssue(start:number|undefined|null,end:number|undefined|null,label:string,endField="endsAt"):ValidationIssue|null{
  if(start==null||end==null)return null;
  if(!Number.isFinite(start))return{field:"startsAt",message:`${label} start date/time is not valid. Choose a valid start before saving.`,overrideAvailable:false};
  if(!Number.isFinite(end))return{field:endField,message:`${label} end date/time is not valid. Choose a valid end before saving.`,overrideAvailable:false};
  if(end<=start)return{field:endField,message:`${label} end date/time must be after the start date/time. Update the end value before saving.`,overrideAvailable:false};
  return null;
}

export function assertValidDateRange(start:number|undefined|null,end:number|undefined|null,label:string,endField="endsAt"){
  const issue=dateRangeIssue(start,end,label,endField);
  if(issue)throw new TRPCError({code:"BAD_REQUEST",message:issue.message,cause:issue});
}

export function ageOnDate(dateOfBirth:number,onDate:number){const birth=new Date(dateOfBirth);const at=new Date(onDate);let age=at.getUTCFullYear()-birth.getUTCFullYear();const beforeBirthday=at.getUTCMonth()<birth.getUTCMonth()||(at.getUTCMonth()===birth.getUTCMonth()&&at.getUTCDate()<birth.getUTCDate());if(beforeBirthday)age--;return age;}

export function youngPersonAgeIssue(dateOfBirth:number|undefined,onDate:number,minimumAge=14):ValidationIssue|null{
  if(dateOfBirth==null)return null;
  if(!Number.isFinite(dateOfBirth)||dateOfBirth>onDate)return{field:"dateOfBirth",message:"Date of birth must be a valid date in the past. Correct the date before saving.",overrideAvailable:false};
  const age=ageOnDate(dateOfBirth,onDate);
  if(age<minimumAge)return{field:"dateOfBirth",message:`The young person will be ${age} on the placement or referral date. The configured minimum age is ${minimumAge}. A registered manager or owner can override this policy with a recorded reason.`,overrideAvailable:true};
  return null;
}

export function assertYoungPersonAge(input:{dateOfBirth?:number;onDate:number;minimumAge?:number;overrideReason?:string;canOverride:boolean}){
  const issue=youngPersonAgeIssue(input.dateOfBirth,input.onDate,input.minimumAge??14);
  if(!issue)return{overridden:false,age:input.dateOfBirth==null?null:ageOnDate(input.dateOfBirth,input.onDate)};
  if(!issue.overrideAvailable)throw new TRPCError({code:"BAD_REQUEST",message:issue.message,cause:issue});
  if(!input.overrideReason?.trim())throw new TRPCError({code:"BAD_REQUEST",message:issue.message,cause:issue});
  if(!input.canOverride)throw new TRPCError({code:"FORBIDDEN",message:"Only an owner or registered manager can override the minimum-age policy."});
  if(input.overrideReason.trim().length<20)throw new TRPCError({code:"BAD_REQUEST",message:"Override reason must contain at least 20 characters so the exceptional decision can be reviewed."});
  return{overridden:true,age:input.dateOfBirth==null?null:ageOnDate(input.dateOfBirth,input.onDate)};
}
