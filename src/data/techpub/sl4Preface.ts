import { format, isValid, parseISO } from 'date-fns';

export const sl4LongDate = (value: string) => isValid(parseISO(value)) ? format(parseISO(value), 'd MMMM yyyy') : value;
export const sl4PrefaceNumber = (number: string) => `${/[a-z]$/.test(number) ? number.at(-1) : number}.`;
export const sl4PrefaceText = (source: string, cutoffDate: string, shortTitle: string) => source
  .replace('DD Month YYYY', sl4LongDate(cutoffDate)).replace('SL-4-xxxxxX', shortTitle)
  .replace(/^[abc]\.\s+/, '');

/** Fixed SL-4 preface narrative. */
export const SL4_PREFACE = [
  {
    "number": "",
    "text": "PREFACE"
  },
  {
    "number": "",
    "text": "PUBLICATION CUT-OFF DATE"
  },
  {
    "number": "1",
    "text": "Information in this Repair Parts List (RPL) is the latest available for this equipment as of DD Month YYYY."
  },
  {
    "number": "",
    "text": "SCOPE OF CONTENTS"
  },
  {
    "number": "2",
    "text": "RPL, SL-4-xxxxxX, serves as a list of all parts required to maintain and support this equipment.  This publication furnishes complete data, including items used in conjunction with and furnished as part of, or with, the equipment, to enable the user to perform required maintenance and supply support of the equipment described herein.  It is comprised of the Preface and the following parts:  Part I, Item Identification Listing; Part II, Item Number Cross-Reference; Part III, National Stock Number Cross-Reference; and Part IV, Part Number Cross-Reference."
  },
  {
    "number": "3",
    "text": "This preface furnishes explanations and application of the information contained in the succeeding parts of this RPL, defines Source Maintenance Recoverability (SMR) codes, and lists applicable Commercial and Government Entities identification."
  },
  {
    "number": "",
    "text": "PART I – ITEM IDENTIFICATION LISTING"
  },
  {
    "number": "4",
    "text": "This listing comprises the main part of the RPL.  It is arranged in columns which show stock numbers, item identification, and other data necessary to maintain this equipment in an operative condition.  Illustrations are placed either before, or in close proximaty to, the component or assembly.  The items are arranged in topdown breakdown sequence within the major combination."
  },
  {
    "number": "5",
    "text": "Repair Parts.  This listing presents all repair parts contained in the equipment and is numbered in sequence by component.  Repair parts need not be identical with parts of the original equipment, but as replacement parts they are considered suitable or preferred."
  },
  {
    "number": "6",
    "text": "Item Numbers (Column 1).  This column specifies item numbers assigned in numerical sequence and in the order that each item appears in the RPL.  The item numbers are provided for reference purposes.  In emergencies, these item numbers may be used for RPL number and date on requisitions which combat units transmit by message."
  },
  {
    "number": "7",
    "text": "Source Maintenance Recoverability Code (Column 2).  This column contains a series of alphabetic letters which denote the uniform source, maintenance recoverability coding structure.  This Code is assigned to items subordinate to or associated with an end item, (i.e., spares, repair parts, and support equipment).  The uniform code format is composed of three parts consisting of a two position Source Code, a two position Maintenance Code, and a one position Recoverability Code."
  },
  {
    "number": "7a",
    "text": "The code provides the user with information on each item relative to (1) the method of obtaining the item; for example, by requisition, fabrication, or salvage; (2) the lowest maintenance echelon authorized to remove, replace and use the item, and the lowest echelon capable to perform complete repair; and (3) disposition action on unserviceable items."
  },
  {
    "number": "7b",
    "text": "Refer to SECNAVINST 4410.23_, Joint Regulation Governing the Use and Application of Uniform Source, Maintenance, and Recoverability Codes for detailed definitions and format structure breakdown. "
  },
  {
    "number": "8",
    "text": "National Stock Number (Column 3).  This column furnishes National Stock Numbers (NSNs) assigned to those centrally managed items required for support of the equipment.  When they have been assigned, NSNs will be used in all supply operations, from original purchase to final disposal of the item.  Absence of an NSN indicates the item is not normally stocked as a repair part, as indicated by they source code portion of the SMR codes.  If an item without an NSN is required, it should be determined if the item can be obtained from these sources, may be requisitioned using the manufacturer’s code and part number referencing the RPL number, date of the RPL, and the line item number which applies."
  },
  {
    "number": "9",
    "text": "Commercial and Government Entity (CAGE) (Column 4).  A five-character code assigned to commercial activities that manufacture or supply items used by the Federal Government and to Government activities that control design or are responsible for the development of certain specifications, standards, or drawings, which control the design of Government items."
  },
  {
    "number": "10",
    "text": "Part Number (Column 5).  A primary number used to identify an item used by the manufacturer (individual, company, firm, corporation, or Government activity) to control the design, characteristics, and production of the item by means of its engineering drawings, specifications, and inspection requirements."
  },
  {
    "number": "11",
    "text": "Item Identification (Column 6).  This column contains the item name and description of the repair part.  When an item is duplicated, the abbreviations (S/A is inserted after the noun name to indicate “same as”.  S/A items refer to the line item number of the item’s first appearance in the major combination.  When an item is fabricated from other items, the abbreviation (FAB FR), followed by the item required for the fabrication, is inserted after the item identification.  When an item is assembled from other items, the abbreviation (ASSEM FR) is used, followed by each item required for the assembly of the item.  When the items comprise a kit or set, a complete list of the components will be given in alphabetical order immediately following the item, under the heading “consist of”, abbreviated (c/o)."
  },
  {
    "number": "12",
    "text": "Replace (Column 7).  This column is divided into sub-columns (a) and (b) and indicates the following:"
  },
  {
    "number": "12a",
    "text": "a.  MAN column “X”  indicates items that must be replaced anytime they are loosened or removed."
  },
  {
    "number": "12b",
    "text": "b.   ECO column “X”  indicates items that have been determined to be economically cheaper to replace during repair than to expend the man-hours necessary to fully inspect each item."
  },
  {
    "number": "12c",
    "text": "c. No “X” in either column indicates the item has special inspection procedures or that the item is further disassembled and its components are covered by a subsequent repair parts list."
  },
  {
    "number": "13",
    "text": "Unit of Measure (Column 8).  This column indicates the measure of quantity specified in column 8 and is not to be used for requisitioning purposes.  When requisitioning parts, the Unit of Issue, Stores Account Code, and Unit Price should be obtained from the “Master Header Information File (MHIF).”"
  },
  {
    "number": "14",
    "text": "Quantity (Column 9).  This column is divided into sub-columns (a) and (b) and indicates the following:"
  },
  {
    "number": "14a",
    "text": "Sub-column (a) shall include the quantity of a maintenance or a non-maintenance part used in a specific application within the end item."
  },
  {
    "number": "14b",
    "text": "Sub-column (b) shall include the consolidated quantity of a maintenance part used in an end item upon the item’s first appearance in this list."
  },
  {
    "number": "",
    "text": "PART II – ITEM NUMBER CROSS-REFERENCE"
  },
  {
    "number": "15",
    "text": "Part II consists of a cross-reference from RPL item numbers to part numbers and manufacturers’ code numbers.  Part II is arranged in numerical sequence by RPL item number and contains only those items listed in Part I which do not have a NSN."
  },
  {
    "number": "",
    "text": "PART III – NATIONAL STOCK NUMBER CROSS-REFERENCE"
  },
  {
    "number": "16",
    "text": "Part III consists of a cross-reference from NSNs to RPL item numbers, part numbers, and manufacturers’ code numbers.  Part III is arranged in NSN sequence and contains only those items listed in Part I which have a NSN."
  },
  {
    "number": "",
    "text": "PART IV – PART NUMBER CROSS-REFERENCE"
  },
  {
    "number": "17",
    "text": "Part IV consists of a cross-reference from part numbers to manufacturers’ code numbers, RPL item numbers, and NSNs for all items listed in Part I for which part numbers are available.  Part IV is arranged in alpha numeric sequence by part number."
  },
  {
    "number": "",
    "text": "PART V – CIRCUIT SYMBOL NUMBER TO ITEM NUMBER CROSS-REFERENCE"
  },
  {
    "number": "18",
    "text": "This cross-reference, which is applicable to electronic equipment RPLs only, consists of all circuit symbol numbers listed in Part I and cross-references each circuit symbol number to its individual RPL item number.  If an excessive quantity of circuit symbols are required, this cross-reference may be omitted."
  },
  {
    "number": "",
    "text": "REQUISITIONING OF PUBLICATIONS"
  },
  {
    "number": "19",
    "text": "This SL-4 is Electronic Distribution Only (EDO) and can only be downloaded from the Marine Corps Technical Data Management Publications Website located at https://app.mcboss.usmc.mil/suite/sites/publications."
  },
  {
    "number": "",
    "text": "MISCELLANEOUS"
  },
  {
    "number": "20",
    "text": "For full information concerning the Marine Corps Stocklist publications, see the current edition of MCO 5215.17_, Marine Corps Technical Publication Management."
  }
] as const;
