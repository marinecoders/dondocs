import type { MaintainedRecipe } from '../maintainedPackageActions';
import { equals, program, question } from '../packageRecipeMembers';
import type { PackageTemplateCondition } from '../packageTemplateProgram';

const arrival = equals('direction', 'arrival');
const departure = equals('direction', 'departure');
const offBase = equals('offBase', true);
const atArrival = (condition: PackageTemplateCondition): PackageTemplateCondition => ({ op: 'all', conditions: [arrival, condition] });

function evidence(key: string, label: string, when?: PackageTemplateCondition) {
  return { key, kind: 'attachment' as const, role: 'supporting-document' as const, required: true, label, ...(when && { when }) };
}

export function okinawaTla(): MaintainedRecipe {
  return {
    kind: 'dondocs-package-template', version: 2, id: 'dondocs_okinawa_tla',
    name: 'Okinawa TLA claim', primaryMemberKey: 'claim', createdAt: 0,
    program: program([
      question('direction', 'When was the lodging used?', 'choice', { options: [
        { id: 'arrival', label: 'Arrival in Okinawa' }, { id: 'departure', label: 'Departure from Okinawa' },
      ] }),
      question('offBase', 'Did you use off-base lodging?', 'boolean'),
      question('extension', 'Does this arrival claim require an extension approval?', 'boolean', { when: arrival }),
      question('terminalReceipt', 'Does your lodging provider require a separate payment terminal receipt?', 'boolean', { when: arrival }),
      question('finalClaim', 'Is this the final arrival claim after moving into quarters?', 'boolean', { when: arrival }),
      question('billeting', 'Does your departure require a billeting or barracks letter?', 'boolean', { when: departure }),
      question('separation', 'Are you departing for separation processing?', 'boolean', { when: departure }),
    ], { requirements: [
      { id: 'claim-review', label: 'Confirm the signed request and itemized receipts cover the same claimant and lodging period',
        kind: 'confirmation', operations: ['review', 'pdf'] },
    ] }),
    members: [
      { ...evidence('claim', 'Signed local TLA request for this claim period'), reference: { id: 'okinawa_tla_guide', edition: '2022-2023' },
        completion: { reviewedScan: true } },
      evidence('orders', 'Orders with applicable endorsements'),
      evidence('receipts', 'Itemized zero-balance lodging receipts'),
      evidence('data-sheet', 'Housing-certified TLA data sheet and housing search record (Appendix B)', arrival),
      evidence('acknowledgment', 'Initialed and signed IPAC acknowledgment (Appendix C)', arrival),
      evidence('statement', 'Travel card statement', { op: 'any', conditions: [arrival, offBase] }),
      evidence('availability', 'Certificate of nonavailability', offBase),
      evidence('terminal', 'Itemized payment terminal receipt', atArrival(equals('terminalReceipt', true))),
      evidence('extension', 'Approved arrival TLA extension (Appendix E)', atArrival(equals('extension', true))),
      evidence('quarters', 'Quarters occupancy or off-base housing allowance record', atArrival(equals('finalClaim', true))),
      evidence('termination', 'Termination of quarters or lease', departure),
      evidence('itinerary', 'Member and applicable dependent flight itineraries', departure),
      evidence('billeting-letter', 'Billeting or barracks letter', { op: 'all', conditions: [departure, equals('billeting', true)] }),
      evidence('dmo', 'Distribution Management Office letter', { op: 'all', conditions: [departure, equals('separation', true)] }),
    ],
  };
}
