import {
  Paragraph as DocxParagraph,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  ImageRun,
} from 'docx';
import type { DocumentData, DocTypeConfig } from '@/types/document';
import type { FontProps } from './styles';
import { SPACING } from './styles';
import { abbreviateName, buildFullName, capitalizeWord, styledRun, base64ToUint8Array } from './utils';

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// Overscore border (top line only, for MOA signatures)
const OVERSCORE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// Build standard single signature block
export function buildSignature(
  data: Partial<DocumentData>,
  config: DocTypeConfig,
  fp: FontProps
): (DocxParagraph | Table)[] {
  const result: (DocxParagraph | Table)[] = [];

  // By direction line
  if (data.byDirection && data.byDirectionAuthority) {
    result.push(
      new DocxParagraph({
        children: [styledRun(`By direction of ${data.byDirectionAuthority}`, fp)],
        alignment: AlignmentType.CENTER,
        spacing: { before: SPACING.large },
      })
    );
  }

  // Signature image or space for handwritten signature
  if (data.signatureType === 'image' && data.signatureImage?.data) {
    const imgData = base64ToUint8Array(data.signatureImage.data);
    result.push(
      new DocxParagraph({
        children: [
          new ImageRun({
            data: imgData,
            transformation: { width: 200, height: 80 },
            type: 'png',
          }),
        ],
        spacing: { before: data.byDirection ? SPACING.normal : SPACING.large },
      })
    );
  } else {
    result.push(
      new DocxParagraph({
        children: [],
        spacing: { before: data.byDirection ? SPACING.normal : SPACING.large, after: SPACING.sigGap },
      })
    );
  }

  // Signature name (abbreviated for 'abbrev', full for 'full')
  const sigName = config.signature === 'abbrev'
    ? abbreviateName(data.sigFirst, data.sigMiddle, data.sigLast)
    : buildFullName(data.sigFirst, data.sigMiddle, data.sigLast);

  result.push(
    new DocxParagraph({
      children: [styledRun(sigName, fp)],
    })
  );

  // Rank
  if (data.sigRank) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.sigRank, fp)],
      })
    );
  }

  // Title
  if (data.sigTitle) {
    result.push(
      new DocxParagraph({
        children: [styledRun(data.sigTitle, fp)],
      })
    );
  }

  return result;
}

// Business letter: complimentary close + full name signature
export function buildBusinessSignature(data: Partial<DocumentData>, fp: FontProps): DocxParagraph[] {
  const result: DocxParagraph[] = [];

  // Complimentary close
  const close = data.complimentaryClose || 'Very respectfully,';
  result.push(
    new DocxParagraph({
      children: [styledRun(close, fp)],
      spacing: { before: SPACING.large },
    })
  );

  // Signature image or space for handwritten signature
  if (data.signatureType === 'image' && data.signatureImage?.data) {
    const imgData = base64ToUint8Array(data.signatureImage.data);
    result.push(
      new DocxParagraph({
        children: [
          new ImageRun({
            data: imgData,
            transformation: { width: 200, height: 80 },
            type: 'png',
          }),
        ],
      })
    );
  } else {
    result.push(
      new DocxParagraph({
        children: [],
        spacing: { after: SPACING.sigGap },
      })
    );
  }

  // Full name
  const fullName = buildFullName(data.sigFirst, data.sigMiddle, data.sigLast);
  result.push(
    new DocxParagraph({
      children: [styledRun(fullName, fp)],
    })
  );

  if (data.sigRank) {
    result.push(new DocxParagraph({ children: [styledRun(data.sigRank, fp)] }));
  }
  if (data.sigTitle) {
    result.push(new DocxParagraph({ children: [styledRun(data.sigTitle, fp)] }));
  }

  return result;
}

// MOA/MOU dual signature block (2-column table with overscore lines)
export function buildMOADualSignature(data: Partial<DocumentData>, fp: FontProps): Table[] {
  // Parse senior name
  const seniorFirstName = capitalizeWord(data.seniorSigName?.split(' ')[0]);
  const seniorLastName = data.seniorSigName?.split(' ').slice(-1)[0]?.toUpperCase() || '';
  const seniorAbbrev = seniorFirstName ? `${seniorFirstName[0]}. ${seniorLastName}` : seniorLastName;

  // Parse junior name
  const juniorFirstName = capitalizeWord(data.juniorSigName?.split(' ')[0]);
  const juniorLastName = data.juniorSigName?.split(' ').slice(-1)[0]?.toUpperCase() || '';
  const juniorAbbrev = juniorFirstName ? `${juniorFirstName[0]}. ${juniorLastName}` : juniorLastName;

  const halfWidth = convertInchesToTwip(3);

  const sigTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      // Empty row for signature space
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [], spacing: { after: SPACING.sigGap } })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [], spacing: { after: SPACING.sigGap } })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      // Name row (with overscore)
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(juniorAbbrev, fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: OVERSCORE_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(seniorAbbrev, fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: OVERSCORE_BORDERS,
          }),
        ],
      }),
      // Rank row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.juniorSigRank || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.seniorSigRank || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      // Title row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.juniorSigTitle || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.seniorSigTitle || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
    ],
  });

  return [sigTable];
}

// Joint letter dual signature block (2-column table without overscore)
export function buildJointDualSignature(data: Partial<DocumentData>, fp: FontProps): Table[] {
  const seniorName = (data.jointSeniorSigName || '').toUpperCase();
  const juniorName = (data.jointJuniorSigName || '').toUpperCase();
  const halfWidth = convertInchesToTwip(3);

  const sigTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      // Empty row for signature space
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [], spacing: { after: SPACING.sigGap } })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [], spacing: { after: SPACING.sigGap } })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      // Name row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(juniorName, fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(seniorName, fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      // Title row
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.jointJuniorSigTitle || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.jointSeniorSigTitle || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
    ],
  });

  return [sigTable];
}

// Joint memorandum dual signature block
export function buildJointMemoDualSignature(data: Partial<DocumentData>, fp: FontProps): Table[] {
  const seniorName = (data.jointMemoSeniorSigName || '').toUpperCase();
  const juniorName = (data.jointMemoJuniorSigName || '').toUpperCase();
  const halfWidth = convertInchesToTwip(3);

  const sigTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [], spacing: { after: SPACING.sigGap } })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [], spacing: { after: SPACING.sigGap } })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(juniorName, fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(seniorName, fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.jointMemoJuniorSigTitle || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
          new TableCell({
            children: [new DocxParagraph({ children: [styledRun(data.jointMemoSeniorSigTitle || '', fp)] })],
            width: { size: halfWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
          }),
        ],
      }),
    ],
  });

  return [sigTable];
}
