/**
 * libo-secured - USMC Correspondence Generator
 * Main Application JavaScript
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// =============================================================================
// DOCUMENT TYPE CONFIGURATIONS
// =============================================================================

const docTypeConfig = {
    // Letters - have letterhead, SSIC, From/To
    naval_letter: { letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev' },
    standard_letter: { letterhead: false, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev' },
    business_letter: { letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: false, signature: 'full', business: true },
    multiple_address_letter: { letterhead: true, ssic: true, fromTo: true, via: true, memoHeader: false, signature: 'abbrev' },
    joint_letter: { letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: false, signature: 'abbrev' },
    // Endorsements
    same_page_endorsement: { letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: false, signature: 'abbrev', endorsement: true },
    new_page_endorsement: { letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: false, signature: 'abbrev', endorsement: true },
    // Memorandums
    mfr: { letterhead: false, ssic: false, fromTo: false, via: false, memoHeader: 'MEMORANDUM FOR THE RECORD', signature: 'full' },
    plain_paper_memorandum: { letterhead: false, ssic: false, fromTo: true, via: false, memoHeader: 'MEMORANDUM', signature: 'full' },
    letterhead_memorandum: { letterhead: true, ssic: false, fromTo: true, via: false, memoHeader: 'MEMORANDUM', signature: 'full' },
    decision_memorandum: { letterhead: true, ssic: false, fromTo: true, via: false, memoHeader: 'DECISION MEMORANDUM', signature: 'full' },
    moa: { letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: 'MEMORANDUM OF AGREEMENT', signature: 'full' },
    mou: { letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: 'MEMORANDUM OF UNDERSTANDING', signature: 'full' },
    joint_memorandum: { letterhead: true, ssic: true, fromTo: true, via: false, memoHeader: 'JOINT MEMORANDUM', signature: 'full' },
    // Executive
    standard_memorandum: { letterhead: true, ssic: false, fromTo: true, via: false, memoHeader: 'MEMORANDUM', signature: 'full' },
    action_memorandum: { letterhead: true, ssic: false, fromTo: true, via: false, memoHeader: 'ACTION MEMORANDUM', signature: 'full' },
    information_memorandum: { letterhead: true, ssic: false, fromTo: true, via: false, memoHeader: 'INFORMATION MEMORANDUM', signature: 'full' },
    // USMC-Specific
    mf: { letterhead: true, ssic: false, fromTo: false, via: false, memoHeader: 'MEMORANDUM FOR', signature: 'full', memoFor: true }
};

// =============================================================================
// UI HELPERS
// =============================================================================

/**
 * Toggle collapsible sections
 */
function toggleSection(el) {
    el.classList.toggle('collapsed');
    el.nextElementSibling.classList.toggle('hidden');
}

/**
 * Show status message
 */
function showStatus(message, type) {
    const status = document.getElementById('status');
    status.style.display = 'block';
    status.className = 'status ' + type;
    status.textContent = message;
    if (type === 'success') {
        setTimeout(() => { status.style.display = 'none'; }, 4000);
    }
}

// =============================================================================
// DATA COLLECTION
// =============================================================================

/**
 * Collect all form data into an object
 */
function collectData() {
    return {
        docType: document.getElementById('docType').value,
        unitLine1: document.getElementById('unitLine1').value,
        unitLine2: document.getElementById('unitLine2').value,
        unitAddress: document.getElementById('unitAddress').value,
        inReplyTo: document.getElementById('inReplyTo').checked,
        ssic: document.getElementById('ssic').value,
        serial: document.getElementById('serial').value,
        date: document.getElementById('date').value,
        from: document.getElementById('from').value,
        to: document.getElementById('to').value,
        via: document.getElementById('via').value,
        subject: document.getElementById('subject').value,
        refs: document.getElementById('refs').value,
        encls: document.getElementById('encls').value,
        body: document.getElementById('body').value,
        sigFirst: document.getElementById('sigFirst').value,
        sigMiddle: document.getElementById('sigMiddle').value,
        sigLast: document.getElementById('sigLast').value,
        sigRank: document.getElementById('sigRank').value,
        sigTitle: document.getElementById('sigTitle').value
    };
}

// =============================================================================
// SIGNATURE FORMATTING
// =============================================================================

/**
 * Get abbreviated signature (F. M. LASTNAME)
 */
function getAbbrevSignature(data) {
    const firstInit = data.sigFirst ? data.sigFirst.charAt(0).toUpperCase() + '.' : '';
    const middleInit = data.sigMiddle ? data.sigMiddle.replace('.', '').toUpperCase() + '.' : '';
    const lastName = data.sigLast ? data.sigLast.toUpperCase() : '';
    return `${firstInit} ${middleInit} ${lastName}`.replace(/\s+/g, ' ').trim();
}

/**
 * Get full signature (First M. LASTNAME)
 */
function getFullSignature(data) {
    const lastName = data.sigLast ? data.sigLast.toUpperCase() : '';
    const middleInit = data.sigMiddle ? data.sigMiddle.replace('.', '') + '.' : '';
    return `${data.sigFirst} ${middleInit} ${lastName}`.replace(/\s+/g, ' ').trim();
}

// =============================================================================
// PARSING HELPERS
// =============================================================================

/**
 * Parse references from textarea (format: "a | Title")
 */
function parseRefs(refsText) {
    if (!refsText.trim()) return [];
    return refsText.trim().split('\n').map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { letter: parts[0] || '', title: parts[1] || '' };
    }).filter(r => r.letter && r.title);
}

/**
 * Parse enclosures from textarea (format: "1 | Title")
 */
function parseEncls(enclsText) {
    if (!enclsText.trim()) return [];
    return enclsText.trim().split('\n').map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { num: parts[0] || '', title: parts[1] || '' };
    }).filter(e => e.num && e.title);
}

// =============================================================================
// LIVE PREVIEW
// =============================================================================

/**
 * Update the live preview panel
 */
function updatePreview() {
    const data = collectData();
    const refs = parseRefs(data.refs);
    const encls = parseEncls(data.encls);
    const config = docTypeConfig[data.docType] || docTypeConfig.naval_letter;

    // Letterhead
    const letterhead = document.getElementById('prev-letterhead');
    if (config.letterhead) {
        letterhead.style.display = 'block';
        document.getElementById('prev-unit1').textContent = data.unitLine1;
        document.getElementById('prev-unit2').textContent = data.unitLine2;
        document.getElementById('prev-address').textContent = data.unitAddress;
    } else {
        letterhead.style.display = 'none';
    }

    // Memo header
    const memoHeader = document.getElementById('prev-memo-header');
    if (config.memoHeader) {
        memoHeader.style.display = 'block';
        memoHeader.textContent = config.memoHeader;
    } else {
        memoHeader.style.display = 'none';
    }

    // In Reply Refer To (per SECNAV M-5216.5 App C, Para 1.a)
    const inReplyBlock = document.getElementById('prev-in-reply');
    if (data.inReplyTo && config.ssic) {
        inReplyBlock.style.display = 'block';
    } else {
        inReplyBlock.style.display = 'none';
    }

    // SSIC block
    const ssicBlock = document.getElementById('prev-ssic-block');
    if (config.ssic) {
        ssicBlock.style.display = 'block';
        document.getElementById('prev-ssic').textContent = data.ssic;
        document.getElementById('prev-serial').textContent = data.serial;
        document.getElementById('prev-date').textContent = data.date;
    } else {
        ssicBlock.style.display = 'none';
    }

    // Date only (for memos without SSIC)
    const dateOnly = document.getElementById('prev-date-only');
    if (!config.ssic && !config.business) {
        dateOnly.style.display = 'block';
        dateOnly.textContent = data.date;
    } else {
        dateOnly.style.display = 'none';
    }

    // From/To block
    const fromBlock = document.getElementById('prev-from-block');
    const toBlock = document.getElementById('prev-to-block');
    if (config.fromTo) {
        fromBlock.style.display = 'block';
        toBlock.style.display = 'block';
        document.getElementById('prev-from').textContent = data.from;
        document.getElementById('prev-to').textContent = data.to;
    } else if (config.memoFor) {
        fromBlock.style.display = 'none';
        toBlock.style.display = 'block';
        document.getElementById('prev-to').textContent = data.to;
    } else {
        fromBlock.style.display = 'none';
        toBlock.style.display = 'none';
    }

    // Via
    const viaBlock = document.getElementById('prev-via-block');
    if (config.via && data.via.trim()) {
        viaBlock.style.display = 'block';
        document.getElementById('prev-via').innerHTML = data.via.split('\n').join('<br>');
    } else {
        viaBlock.style.display = 'none';
    }

    // Subject
    document.getElementById('prev-subject').textContent = data.subject.toUpperCase();

    // References
    const refBlock = document.getElementById('prev-ref-block');
    if (refs.length > 0) {
        refBlock.style.display = 'block';
        document.getElementById('prev-refs').innerHTML = refs.map(r => `(${r.letter}) ${r.title}`).join('<br>');
    } else {
        refBlock.style.display = 'none';
    }

    // Enclosures
    const enclBlock = document.getElementById('prev-encl-block');
    if (encls.length > 0) {
        enclBlock.style.display = 'block';
        document.getElementById('prev-encls').innerHTML = encls.map(e => `(${e.num}) ${e.title}`).join('<br>');
    } else {
        enclBlock.style.display = 'none';
    }

    // Body
    document.getElementById('prev-body').textContent = data.body;

    // Signature
    if (config.signature === 'full') {
        document.getElementById('prev-sig').innerHTML = `${getFullSignature(data)}<br>${data.sigRank}<br>${data.sigTitle}`;
    } else {
        document.getElementById('prev-sig').textContent = getAbbrevSignature(data);
    }
}

// =============================================================================
// LATEX GENERATION
// =============================================================================

/**
 * Escape LaTeX special characters
 */
function escapeLatex(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/&/g, '\\&')
        .replace(/%/g, '\\%')
        .replace(/\$/g, '\\$')
        .replace(/#/g, '\\#')
        .replace(/_/g, '\\_')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Generate config/document.tex
 */
function generateDocumentTex(data) {
    return `%=============================================================================
% DOCUMENT CONFIGURATION - Generated by libo-secured
%=============================================================================

\\setDocumentType{${data.docType}}

${data.inReplyTo ? '\\enableInReplyReferTo' : '% \\enableInReplyReferTo'}

\\setSSIC{${escapeLatex(data.ssic)}}
\\setSerial{${escapeLatex(data.serial)}}
\\setDocumentDate{${escapeLatex(data.date)}}

\\setFrom
    {${escapeLatex(data.from)}}
    {}{}{}

\\setTo
    {${escapeLatex(data.to)}}
    {}{}{}

${data.via.trim() ? `\\setVia
    {${escapeLatex(data.via.split('\n')[0] || '')}}
    {${escapeLatex(data.via.split('\n')[1] || '')}}
    {${escapeLatex(data.via.split('\n')[2] || '')}}
    {${escapeLatex(data.via.split('\n')[3] || '')}}` : '% No Via'}

\\setSubject{${escapeLatex(data.subject)}}

\\setBusinessSalutation{Dear Sir or Madam:}
\\setBusinessClose{Very respectfully,}

\\setPOC{example@usmc.mil}
`;
}

/**
 * Generate config/letterhead.tex
 */
function generateLetterheadTex(data) {
    return `%=============================================================================
% LETTERHEAD CONFIGURATION - Generated by libo-secured
%=============================================================================

\\setLetterhead
    {${escapeLatex(data.unitLine1)}}
    {${escapeLatex(data.unitLine2)}}
    {${escapeLatex(data.unitAddress.split(',')[0] || '')}}
    {${escapeLatex(data.unitAddress.split(',').slice(1).join(',').trim() || '')}}
`;
}

/**
 * Generate config/signatory.tex
 */
function generateSignatoryTex(data) {
    return `%=============================================================================
% SIGNATURE CONFIGURATION - Generated by libo-secured
%=============================================================================

\\setSignatory
    {${escapeLatex(data.sigFirst)}}
    {${escapeLatex(data.sigMiddle)}}
    {${escapeLatex(data.sigLast)}}
    {${escapeLatex(data.sigRank)}}
    {${escapeLatex(data.sigTitle)}}

\\setSignatureImage{}
`;
}

/**
 * Generate config/references.tex
 */
function generateReferencesTex(data) {
    const refs = parseRefs(data.refs);
    if (refs.length === 0) return '% No references\n';
    return `%=============================================================================
% REFERENCES - Generated by libo-secured
%=============================================================================

${refs.map(r => `\\refitem{${r.letter}}{${escapeLatex(r.title)}}`).join('\n')}
`;
}

/**
 * Generate config/enclosures.tex
 */
function generateEnclosuresTex(data) {
    const encls = parseEncls(data.encls);
    if (encls.length === 0) return '% No enclosures\n';
    return `%=============================================================================
% ENCLOSURES - Generated by libo-secured
%=============================================================================

${encls.map(e => `\\enclosure{${e.num}}{}{${escapeLatex(e.title)}}`).join('\n')}
`;
}

/**
 * Generate config/body.tex
 */
function generateBodyTex(data) {
    return `%=============================================================================
% DOCUMENT BODY - Generated by libo-secured
%=============================================================================

${data.body.split('\n\n').map(para => {
    const trimmed = para.trim();
    if (!trimmed) return '';
    // Check if it starts with a number (paragraph)
    if (/^\d+\./.test(trimmed)) {
        const match = trimmed.match(/^(\d+)\.\s*(.*)/s);
        if (match) {
            return `\\parasection{}\n${escapeLatex(match[2])}`;
        }
    }
    return escapeLatex(trimmed);
}).filter(p => p).join('\n\n')}
`;
}

// =============================================================================
// DOWNLOAD FUNCTIONS
// =============================================================================

/**
 * Download all config files as ZIP
 */
async function downloadConfigs() {
    const data = collectData();
    const zip = new JSZip();

    // Add config files
    const configFolder = zip.folder('config');
    configFolder.file('document.tex', generateDocumentTex(data));
    configFolder.file('letterhead.tex', generateLetterheadTex(data));
    configFolder.file('signatory.tex', generateSignatoryTex(data));
    configFolder.file('references.tex', generateReferencesTex(data));
    configFolder.file('enclosures.tex', generateEnclosuresTex(data));
    configFolder.file('body.tex', generateBodyTex(data));
    configFolder.file('classification.tex', '% No classification markings\n');
    configFolder.file('reference-urls.tex', '% No reference URLs\n');

    // Generate and download
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'libo-secured-config.zip';
    a.click();
    URL.revokeObjectURL(url);

    showStatus('Config files downloaded! Extract to your libo-secured folder and run: make build', 'success');
}

/**
 * Quick PDF using jsPDF
 */
function downloadPDF() {
    try {
        const { jsPDF } = window.jspdf;
        const data = collectData();
        const refs = parseRefs(data.refs);
        const encls = parseEncls(data.encls);
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });

        let y = MARGIN_TOP;

        // Letterhead
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(0, 40, 85);
        pdf.text('UNITED STATES MARINE CORPS', PAGE_WIDTH / 2, y, { align: 'center' });
        y += 14;
        pdf.setFontSize(9);
        pdf.text(data.unitLine1, PAGE_WIDTH / 2, y, { align: 'center' });
        y += 11;
        pdf.setFont('helvetica', 'normal');
        pdf.text(data.unitLine2, PAGE_WIDTH / 2, y, { align: 'center' });
        y += 11;
        pdf.setFontSize(8);
        pdf.text(data.unitAddress, PAGE_WIDTH / 2, y, { align: 'center' });
        y += 36;

        // SSIC block
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        const rightX = PAGE_WIDTH - MARGIN_RIGHT;
        pdf.text(data.ssic, rightX, y, { align: 'right' });
        y += 14;
        pdf.text(data.serial, rightX, y, { align: 'right' });
        y += 14;
        pdf.text(data.date, rightX, y, { align: 'right' });
        y += 28;

        // From/To
        pdf.text('From:  ' + data.from, MARGIN_LEFT, y);
        y += 14;
        pdf.text('To:    ' + data.to, MARGIN_LEFT, y);
        y += 14;

        // Via
        if (data.via.trim()) {
            data.via.split('\n').forEach((line, i) => {
                pdf.text((i === 0 ? 'Via:   ' : '       ') + line.trim(), MARGIN_LEFT, y);
                y += 14;
            });
        }
        y += 14;

        // Subject
        pdf.text('Subj:  ' + data.subject.toUpperCase(), MARGIN_LEFT, y);
        y += 14;

        // Refs
        if (refs.length > 0) {
            refs.forEach((r, i) => {
                pdf.text((i === 0 ? 'Ref:   ' : '       ') + `(${r.letter}) ${r.title}`, MARGIN_LEFT, y);
                y += 14;
            });
        }

        // Encls
        if (encls.length > 0) {
            encls.forEach((e, i) => {
                pdf.text((i === 0 ? 'Encl:  ' : '       ') + `(${e.num}) ${e.title}`, MARGIN_LEFT, y);
                y += 14;
            });
        }
        y += 14;

        // Body
        const bodyLines = data.body.split('\n');
        for (const line of bodyLines) {
            const wrappedLines = pdf.splitTextToSize(line, CONTENT_WIDTH);
            for (const wrappedLine of wrappedLines) {
                if (y > PAGE_HEIGHT - MARGIN_BOTTOM - 72) {
                    pdf.addPage();
                    y = MARGIN_TOP;
                }
                pdf.text(wrappedLine, MARGIN_LEFT, y);
                y += 14;
            }
            y += 4;
        }

        // Signature
        y += 28;
        if (y > PAGE_HEIGHT - MARGIN_BOTTOM - 36) {
            pdf.addPage();
            y = MARGIN_TOP + 72;
        }
        pdf.text(getAbbrevSignature(data), PAGE_WIDTH / 2 + 36, y);

        pdf.save('correspondence.pdf');
        showStatus('Quick PDF downloaded!', 'success');
    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
    }
}

/**
 * Download simple .tex file
 */
function downloadTeX() {
    const data = collectData();
    const refs = parseRefs(data.refs);
    const sig = getAbbrevSignature(data);

    const tex = `\\documentclass[12pt, letterpaper]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{courier}
\\usepackage{xcolor}
\\renewcommand{\\familydefault}{\\ttdefault}
\\raggedright
\\setlength{\\parindent}{0pt}
\\definecolor{navyblue}{RGB}{0, 40, 85}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
{\\color{navyblue}\\textbf{UNITED STATES MARINE CORPS}}\\\\[2pt]
{\\color{navyblue}\\small\\textbf{${escapeLatex(data.unitLine1)}}}\\\\[2pt]
{\\color{navyblue}\\small ${escapeLatex(data.unitLine2)}}\\\\[2pt]
{\\color{navyblue}\\scriptsize ${escapeLatex(data.unitAddress)}}
\\end{center}

\\vspace{0.5in}

\\hfill
\\begin{tabular}[t]{@{}l@{}}
${escapeLatex(data.ssic)}\\\\
${escapeLatex(data.serial)}\\\\
${escapeLatex(data.date)}
\\end{tabular}

\\vspace{0.25in}

From:  ${escapeLatex(data.from)}\\\\
To:    ${escapeLatex(data.to)}
${data.via.trim() ? '\\\\Via:   ' + data.via.split('\n').map(l => escapeLatex(l.trim())).join('\\\\\n       ') : ''}

\\vspace{0.15in}

Subj:  ${escapeLatex(data.subject.toUpperCase())}

${refs.length > 0 ? '\\vspace{0.1in}\n\nRef:   ' + refs.map(r => `(${r.letter}) ${escapeLatex(r.title)}`).join('\\\\\n       ') : ''}

\\vspace{0.25in}

${data.body.split('\n').map(line => escapeLatex(line)).join('\n\n')}

\\vspace{0.5in}

\\hspace{3.25in}${escapeLatex(sig)}

\\end{document}
`;

    const blob = new Blob([tex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'correspondence.tex';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('LaTeX file downloaded!', 'success');
}

// =============================================================================
// DATA LOADING
// =============================================================================

/**
 * Load SSIC codes from JSON and populate datalist
 */
async function loadSSICData() {
    try {
        const response = await fetch('data/ssic.json');
        const data = await response.json();
        const datalist = document.getElementById('ssic-list');

        // Flatten codes into options
        for (const [code, info] of Object.entries(data.codes)) {
            // Add main category
            const option = document.createElement('option');
            option.value = code;
            option.label = `${code} - ${info.title}`;
            datalist.appendChild(option);

            // Add subcodes
            if (info.subcodes) {
                for (const [subcode, title] of Object.entries(info.subcodes)) {
                    const subOption = document.createElement('option');
                    subOption.value = subcode;
                    subOption.label = `${subcode} - ${title}`;
                    datalist.appendChild(subOption);
                }
            }
        }
    } catch (error) {
        console.warn('Could not load SSIC data:', error);
    }
}

// Store loaded unit data globally for selectUnit function
let unitData = [];

/**
 * Load unit data from JSON and populate dropdown
 */
async function loadUnitData() {
    try {
        const response = await fetch('data/units.json');
        const data = await response.json();
        unitData = data.units;

        const select = document.getElementById('unitSelect');

        // Group units by base for easier navigation
        const baseGroups = {};
        for (const unit of data.units) {
            const base = unit.base || 'Other';
            if (!baseGroups[base]) {
                baseGroups[base] = [];
            }
            baseGroups[base].push(unit);
        }

        // Create optgroups for each base
        for (const [base, units] of Object.entries(baseGroups).sort()) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = base;

            for (const unit of units) {
                const option = document.createElement('option');
                option.value = unit.name;
                option.textContent = unit.name;
                optgroup.appendChild(option);
            }

            select.appendChild(optgroup);
        }
    } catch (error) {
        console.warn('Could not load unit data:', error);
    }
}

/**
 * Handle unit selection from dropdown
 */
function selectUnit() {
    const select = document.getElementById('unitSelect');
    const selectedName = select.value;

    if (!selectedName) return;

    const selectedUnit = unitData.find(u => u.name === selectedName);
    if (selectedUnit) {
        document.getElementById('unitLine1').value = selectedUnit.name;
        document.getElementById('unitLine2').value = selectedUnit.higherHQ;
        document.getElementById('unitAddress').value = selectedUnit.address;
        updatePreview();
    }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Load data files
    loadSSICData();
    loadUnitData();

    // Initialize preview
    updatePreview();
});
