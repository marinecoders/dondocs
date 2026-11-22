import type { TestStore } from './compileLatex';
import { emptyJointCommand } from '@/lib/jointLetterCommands';

export function jointLetterFixture(additional = true): TestStore {
  return { docType: 'joint_letter', formData: {
    docType: 'joint_letter', fontFamily: 'times', fontSize: '12pt', classLevel: 'unclassified',
    pageNumbering: 'none', signatureType: 'none', department: 'usmc',
    jointSeniorName: 'SENIOR COMMAND', jointSeniorZip: 'Norfolk, VA 23511', jointSeniorCode: 'SENIOR',
    jointSeniorFrom: 'Commanding Officer, Senior Command', jointSeniorSigName: 'A. SENIOR', jointSeniorSigTitle: 'Commanding Officer',
    ssic: '5216', serial: '101', date: '21 Nov 26',
    jointJuniorName: 'JUNIOR COMMAND', jointJuniorZip: 'Norfolk, VA 23511', jointJuniorCode: 'JUNIOR',
    jointJuniorFrom: 'Commanding Officer, Junior Command', jointJuniorSigName: 'B. JUNIOR', jointJuniorSigTitle: 'Commanding Officer',
    jointJuniorSSIC: '5216', jointJuniorSerial: '201', jointJuniorDate: '20 Nov 26',
    jointTo: 'Distribution List', jointSubject: 'THREE COMMAND COORDINATION',
    ...(additional ? { jointAdditionalCommands: [{ ...emptyJointCommand(), id: 'third-command', name: 'MIDDLE COMMAND', location: 'Norfolk, VA 23511', code: 'MIDDLE', ssic: '5216', serial: '301', date: '19 Nov 26', from: 'Commanding Officer, Middle Command', signatureName: 'C. MIDDLE', signatureTitle: 'Deputy Commander', acting: true }] } : {}),
  }, paragraphs: [{ id: 'body', text: 'Coordinate the shared action among the commands.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
}
