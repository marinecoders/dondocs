import type { LetterTemplate } from '../types';

export const appointmentBoardMember: LetterTemplate = {
  id: 'appointment-board-member',
  name: 'Appointment to Board/Committee',
  category: 'Administrative',
  description: 'Appoint a member to a selection, promotion, or administrative board',
  docType: 'naval_letter',
  ssic: '5216',
  subject: 'APPOINTMENT TO [BOARD/COMMITTEE NAME]',
  paragraphs: [
    { text: 'Appointment. Per reference (a), you are hereby appointed as a [VOTING MEMBER/RECORDER/PRESIDENT] of the [BOARD/COMMITTEE NAME] convening on [DATE] at 0900 in Building 35, Presidio of San Francisco.', level: 0 },
    { text: 'Purpose. The purpose of this board is to [STATE PURPOSE - e.g., review candidates for meritorious promotion, evaluate administrative separation, select personnel for special duty assignment, etc.].', level: 0 },
    { text: 'Composition. The board will consist of: President: [RANK/NAME]; Members: [LIST MEMBERS]; Recorder: [RANK/NAME]. [Additional personnel as required].', level: 0 },
    { text: 'Procedures. Conduct all proceedings in accordance with reference (a). The recorder will maintain accurate minutes and all documentation. All deliberations are confidential and will not be disclosed outside official channels.', level: 0 },
    { text: 'Report. Upon completion of proceedings, submit the board report with findings and recommendations to the undersigned within [NUMBER] working days.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1400.32D' },
  ],
};
