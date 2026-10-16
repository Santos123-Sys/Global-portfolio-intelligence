import {it,expect} from 'vitest';
import {checkAuditReport} from '../scripts/check-dev-audit.mjs';
const clean=()=>({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}});
it('never accepts missing, failed or unsupported scanner evidence as a clean scan',()=>{
 for(const report of [{},{error:{code:'ENOAUDIT'}},{...clean(),error:{code:'ECONNRESET'}},{...clean(),vulnerabilities:null},{...clean(),auditReportVersion:3},{...clean(),metadata:{}}])
  expect(()=>checkAuditReport(report)).toThrow();
 expect(checkAuditReport(clean())).toEqual({allowed:[],checked:0});
});
it('blocks unapproved severe dependencies while preserving only the documented advisory exception',()=>{
 const report={...clean(),vulnerabilities:{tool:{severity:'high',via:[{severity:'high',url:'https://github.com/advisories/GHSA-synthetic-unapproved'}]}}};
 expect(()=>checkAuditReport(report)).toThrow('Unapproved');
 report.vulnerabilities.tool.via[0].url='https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
 expect(checkAuditReport(report).allowed).toEqual(['tool']);
});
