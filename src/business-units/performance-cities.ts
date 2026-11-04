import { BadRequestException } from '@nestjs/common';
export function performanceCities(value?:string) {
  if(value!==undefined && (typeof value!=='string' || value.length>5100))throw new BadRequestException('Invalid employee cities.');
  const cities=value?value.split(','):[];
  if(cities.length>100 || cities.some(city=>! /^[A-Z_]{1,50}$/.test(city)))throw new BadRequestException('Invalid employee cities.');
  return [...new Set(cities)];
}
export function groupPerformanceCities<Row extends {city?:string;name:string;id:string}>(rows:Row[],keys:(keyof Row)[]) {
  const groups=new Map<string,Row[]>();
  for(const row of rows){const city=row.city||'UNSPECIFIED';const group=groups.get(city);if(group)group.push(row);else groups.set(city,[row]);}
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([city,members])=>({city,total:members.length,rows:members.slice(0,3),summary:Object.fromEntries(keys.map(key=>[key,members.every(row=>row[key]==null)?null:members.reduce((sum,row)=>sum+Number(row[key]||0),0)]))}));
}
