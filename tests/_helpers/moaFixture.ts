import type { TestStore } from './compileLatex';

export function moaFixture(docType = 'moa'): TestStore {
  return {
    docType,
    documentMode: 'compliant',
    formData: {
      fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none',
      department: 'usmc', unitLine1: 'SENIOR COMMAND',
      unitAddress: '100 MAIN STREET, CAMP LEJEUNE NC 28542',
      sealType: 'dod', letterheadColor: 'blue', classLevel: 'unclassified',
      officeCode: 'S-3', signatureType: 'none',
      seniorCommandName: 'Senior Command', seniorSSIC: '5216', seniorSerial: '001', seniorDate: '6 Nov 26',
      seniorSigName: 'JORDAN M. RIVERA', seniorSigTitle: 'Commanding General',
      juniorCommandName: 'Junior Command', juniorSSIC: '5216', juniorSerial: '002', juniorDate: '5 Nov 26',
      juniorSigName: 'ALEX T. MORGAN', juniorSigTitle: 'Commanding Officer',
      moaSubject: 'COORDINATION AGREEMENT',
      jointSeniorName: 'Senior Command', jointSeniorCode: 'SENIOR', jointSeniorFrom: 'Commanding General, Senior Command',
      jointJuniorName: 'Junior Command', jointJuniorCode: 'JUNIOR', jointJuniorFrom: 'Commanding Officer, Junior Command',
      jointJuniorSSIC: '5216', jointJuniorSerial: '002', jointJuniorDate: '5 Nov 26',
      jointSeniorSigName: 'JORDAN M. RIVERA', jointSeniorSigTitle: 'Commanding General',
      jointJuniorSigName: 'ALEX T. MORGAN', jointJuniorSigTitle: 'Commanding Officer',
      jointTo: 'Chief of Naval Operations', jointSubject: 'COORDINATION AGREEMENT',
      ssic: '5216', serial: '001', date: '6 Nov 26',
    },
    references: [], enclosures: [], copyTos: [], distributions: [],
    paragraphs: [{ level: 0, text: 'This agreement establishes coordination between the senior and junior commands.' }],
  };
}
