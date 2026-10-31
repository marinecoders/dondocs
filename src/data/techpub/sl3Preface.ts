/** Fixed preface from the supplied MARCORSYSCOM SL-3 template. */
export const SL3_PREFACE = [
  {
    text: 'Scope.  This publication lists all components and accessories for collection-type supply items, such as major combinations, systems, groups, outfits, kits, sets, or assortments.  The components to be issued with the end item are identified under the heading of “SUPPLY SYSTEM RESPONSIBILITY ITEMS” and when required, under the heading “COLLATERAL MATERIEL.”  End items requiring collateral materiel are governed by whether the end item is an initial or replacement issue.  Those items listed under the “USING UNIT RESPONSIBILITY ITEMS” heading are to be requisitioned separately through the supply system, when applicable, and if the unit requires those items.  Using units are also responsible for requisitioning the required publications to support the end item identified by the Identification (ID) number shown on the cover of the SL-3.  The end item/kit will be complete when the total quantity of items within are on hand.  If any items are missing, then it is incomplete.',
    note: false,
  },
  {
    text: 'List of Components.  This listing comprises the major portion of this publication.  The data, arranged in columnar form, present the information needed to identify the item and determine its type of issue.',
    note: false,
  },
  {
    text: 'Item Number (Column 1).  This column specifies a number assigned to each item as it appears in the list.  Numbers are assigned in sequence and correspond to the illustration numbers.  If no illustration is available, “not shown” will appear above the item number where the illustration should appear.',
    note: false,
  },
  {
    text: 'National Stock Number (Column 2).  This column furnishes the National Stock Number (NSN) assigned to the item.  Items without NSNs assigned should be requisitioned by part number and Commercial And Government Entity (CAGE) code.  When NSNs are assigned to these items, changes to this publication will be published during the next revision.',
    note: false,
  },
  {
    text: 'Item Identification (Column 3).  This column provides the official catalogued item name and description listed under the heading of either “SUPPLY SYSTEM RESPONSIBILITY ITEMS,” “COLLATERAL MATERIEL,” or “USING UNIT RESPONSIBILITY ITEMS.”',
    note: false,
  },
  {
    text: 'Unit of Measure (Column 4).  This column gives the measurement standard of each item.  It may or may not be the same as the unit of issue.  For example, the unit of issue of a certain wire is coil but only 4 feet are required for the end item.  Therefore, the unit of measure shown will not be used for requisitioning purposes.  For the proper unit of issue and other required management data, refer to TDM-CATALYST Catalog, if required.  Also utilize the User Manual (UM) 4000-125 to support the Marine Corps Order (MCO) 4400.201_ for the most accurate definition of unit of issue/unit of measure.',
    note: false,
  },
  {
    text: 'Quantity Used in Unit (Column 5).  This column lists the total quantity of an item, according to the unit of measure, required for full functional operation of the end item.',
    note: false,
  },
  {
    text: 'Periodic Inventory (Column 6).  This column provides space for recording inventory results in accordance with MCO 4790.2_, TM 4700-15/1_, and MCO 4400.201_, or as directed by the Unit Commander.',
    note: false,
  },
  {
    text: 'Using Unit Remarks (Column 7).  This column provides space for remarks pertaining to the data recorded in the Inventory column (Column 6) when an inventory is conducted.',
    note: false,
  },
  {
    text: '(*) If required, add an asterisk with Serial No. to the Using Unit Remarks column to indicate serialized items.  This entry should be in the uppermost left portion of the cell.',
    note: true,
  },
  {
    text: 'Supply System Responsibility Items (SSRI).  An alphabetical list of items that are furnished with and must be turned in with the end item.  Any item requiring replacement is the responsibility of the holding Organization or Using Unit in accordance with MCO 4400.201_.',
    note: false,
  },
  {
    text: 'Collateral Materiel.  An alphabetical list of items that are supplied with the initial issue of the end item and are retained by the unit.  Not all collateral materiel is cataloged for NSN assignment.  The “XXXX-XX-XXX-XXXX” NSN shown under the heading of “COLLATERAL MATERIEL” (if applicable) is for control within the distribution system only, and is not authorized for requisitioning purposes in accordance with MCO 4400.201_.',
    note: false,
  },
  {
    text: 'Refer to the Marine Corps Technical Data Management Publication Website located at https://app.mcboss.usmc.mil/suite/sites/publications and requisition the required publications to support the item identified by the ID number shown on the cover of this SL-3.',
    note: true,
  },
  {
    text: 'Using Unit Responsibility Items (UURI).  An alphabetical list of items that will not be issued with the end item and must be requisitioned, as required, through the supply system by the Using Unit or holding Organization in accordance with MCO 4400.201_.',
    note: false,
  },
  {
    text: 'Sustainment (Depot) Level of Maintenance Rehabilitation Program.  Major items returned under this program will be evacuated under the provision(s) of the applicable Marine Corps Order(s) with the items listed under SUPPLY SYSTEM RESPONSIBILITY ITEMS.  Rebuild and replacement under the sustainment (depot) level of maintenance rehabilitation program will be limited to these items only.  Those items under the heading “COLLATERAL MATERIEL” and “USING UNIT RESPONSIBILITY ITEMS” shall be held by using Organizations for application to the replacement end item.',
    note: false,
  },
  {
    text: 'Requisitioning of Publications.  This SL-3 is Electronic Distribution Only (EDO) and can only be downloaded from the Marine Corps Technical Data Management Publications Website located at https://app.mcboss.usmc.mil/suite/sites/publications.',
    note: false,
  },
  {
    text: 'Marine Corps Stocklist Publication Information.  For full information concerning the Marine Corps Stocklist publications, see the current edition of MCO 5215.17_, Marine Corps Technical Publication Management.',
    note: false,
  },
  {
    text: 'Duplication in SSRI and UURI Sections.  Some items may be listed in the SSRI section of this SL-3 and are duplicated in the UURI section to ensure that Units with unique quantity requirements for certain items are authorized to obtain them.',
    note: false,
  },
  {
    text: 'Reproduction for Inventory.  Components Lists pages are used for periodic inventory purposes by Using Units and may be reproduced locally by the user as required.',
    note: false,
  },
];

/** Definitions for abbreviations in the fixed template and generated fields. */
export const SL3_ABBREVIATIONS = [
  ['C', 'Complete (inventory legend); Confidential (portion marking)'],
  ['CAGE', 'Commercial and Government Entity'],
  ['CMC', 'Commandant of the Marine Corps'],
  ['COMMARCORSYSCOM', 'Commander, Marine Corps Systems Command'],
  ['CTI', 'Controlled Technical Information'],
  ['CUI', 'Controlled Unclassified Information'],
  ['DC', 'District of Columbia'],
  ['DCI', 'Deputy Commandant for Information'],
  ['EA', 'Each (unit code)'],
  ['EDO', 'Electronic Distribution Only'],
  ['Fig', 'Figure'],
  ['EXPT', 'Export Controlled'],
  ['FOUO', 'For Official Use Only'],
  ['I', 'Incomplete (inventory legend); Intelligence (message addressee)'],
  ['ID', 'Identification'],
  ['KBA', 'Knowledge Base Article'],
  ['L', 'Installations and Logistics (message addressee)'],
  ['M', 'Missing (inventory legend)'],
  ['MC', 'Marine Corps'],
  ['MCO', 'Marine Corps Order'],
  ['No.', 'Number'],
  ['NOFORN', 'Not Releasable to Foreign Nationals'],
  ['NSN', 'National Stock Number'],
  ['PAE', 'Portfolio Acquisition Executive'],
  ['PCN', 'Publication Control Number'],
  ['PdM', 'Product Manager'],
  ['PEO', 'Program Executive Officer'],
  ['PM', 'Program Manager'],
  ['PN', 'Part Number'],
  ['POC', 'Point of Contact'],
  ['PPO', 'Plans, Policies, and Operations'],
  ['Qty', 'Quantity'],
  ['Ref Des', 'Reference Designator'],
  ['S', 'Serviceable (inventory legend); Secret (portion marking)'],
  ['SCI', 'Sensitive Compartmented Information'],
  ['SD', 'Safety Division'],
  ['SL', 'Stock List'],
  ['SSRI', 'Supply System Responsibility Items'],
  ['TAMCN', 'Table of Authorized Materiel Control Number'],
  ['TDM', 'Technical Data Management'],
  ['TFSMS', 'Total Force Structure Management System'],
  ['TM', 'Technical Manual'],
  ['TS', 'Top Secret'],
  ['U', 'Unserviceable (inventory legend); Unclassified (portion marking)'],
  ['U.S.', 'United States'],
  ['U/I', 'Unit of Issue'],
  ['U/M', 'Unit of Measure'],
  ['UM', 'User Manual'],
  ['USMC', 'United States Marine Corps'],
  ['UURI', 'Using Unit Responsibility Items'],
  ['VA', 'Virginia'],
] as const;

/** Core meanings cannot be silently overwritten by an author definition. */
export function sl3Definitions(
  custom: readonly {
    term: string;
    meaning: string;
    portionMarking: string;
  }[] = [],
) {
  return [
    ...SL3_ABBREVIATIONS.map(([term, meaning]) => ({
      term,
      meaning,
      portionMarking: 'U',
    })),
    ...custom,
  ].sort((a, b) =>
    a.term
      .trim()
      .toUpperCase()
      .localeCompare(b.term.trim().toUpperCase(), 'en'),
  );
}
