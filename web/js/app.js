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
// SWIFTLATEX ENGINE
// =============================================================================

let pdfTexEngine = null;
let engineReady = false;
let engineLoading = false;

/**
 * Reset the LaTeX engine (required after fatal errors)
 */
async function resetLatexEngine() {
    console.log('Resetting LaTeX engine...');
    engineReady = false;
    engineLoading = false;
    pdfTexEngine = null;
    await initLatexEngine();
}

/**
 * Initialize SwiftLaTeX PdfTeX engine
 */
async function initLatexEngine() {
    if (engineReady || engineLoading) return;

    if (typeof PdfTeXEngine === 'undefined') {
        console.warn('SwiftLaTeX PdfTeXEngine not loaded');
        return;
    }

    engineLoading = true;
    showStatus('Loading LaTeX engine...', 'success');

    try {
        pdfTexEngine = new PdfTeXEngine();
        await pdfTexEngine.loadEngine();

        // Pre-load bundled TeX Live packages into kpathsea cache
        // This bypasses HTTP fetch and works fully offline
        if (typeof TEXLIVE_PACKAGES !== 'undefined' && Array.isArray(TEXLIVE_PACKAGES)) {
            console.log('Preloading TeX Live packages into kpathsea cache...');
            let packageCount = 0;
            for (const pkg of TEXLIVE_PACKAGES) {
                pdfTexEngine.preloadTexliveFile(pkg.format, pkg.filename, pkg.content);
                packageCount++;
            }
            console.log(`Preloaded ${packageCount} TeX Live packages`);
        }

        // Pre-load bundled font metrics (base64 decoded)
        if (typeof TEXLIVE_FONTS !== 'undefined' && Array.isArray(TEXLIVE_FONTS)) {
            console.log('Preloading font metrics...');
            let fontCount = 0;
            for (const font of TEXLIVE_FONTS) {
                // Debug logging for first few fonts
                if (fontCount < 3) {
                    console.log(`Font ${fontCount}: ${font.filename}, base64 length: ${font.content.length}`);
                }

                // Decode base64 to binary
                const binaryString = atob(font.content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                // Debug decoded size for cmmi8.tfm specifically
                if (font.filename === 'cmmi8.tfm') {
                    console.log(`CRITICAL: cmmi8.tfm decoded to ${bytes.length} bytes`);
                    console.log(`First 10 bytes: ${Array.from(bytes.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                }

                pdfTexEngine.preloadTexliveFile(font.format, font.filename, bytes);
                fontCount++;
            }
            console.log(`Preloaded ${fontCount} font metrics`);
        }

        // Pre-load Type1 fonts (base64 decoded)
        if (typeof TEXLIVE_TYPE1_FONTS !== 'undefined' && Array.isArray(TEXLIVE_TYPE1_FONTS)) {
            console.log('Preloading Type1 fonts...');
            let type1Count = 0;
            for (const font of TEXLIVE_TYPE1_FONTS) {
                // Decode base64 to binary
                const binaryString = atob(font.content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                pdfTexEngine.preloadTexliveFile(font.format, font.filename, bytes);
                type1Count++;
            }
            console.log(`Preloaded ${type1Count} Type1 fonts`);
        }

        // Pre-load Virtual fonts (base64 decoded)
        if (typeof TEXLIVE_VF_FONTS !== 'undefined' && Array.isArray(TEXLIVE_VF_FONTS)) {
            console.log('Preloading Virtual fonts...');
            let vfCount = 0;
            for (const font of TEXLIVE_VF_FONTS) {
                // Decode base64 to binary
                const binaryString = atob(font.content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                pdfTexEngine.preloadTexliveFile(font.format, font.filename, bytes);
                vfCount++;
            }
            console.log(`Preloaded ${vfCount} Virtual fonts`);
        }

        // Wait for worker to process all preload messages
        // postMessage is async, so we need to give the worker time to process
        // Increased from 200ms to 1000ms to ensure all TFM fonts are preloaded
        console.log('Waiting for worker to process preload messages...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Preload wait complete');

        engineReady = true;
        engineLoading = false;
        console.log('SwiftLaTeX engine ready with bundled packages');
    } catch (error) {
        console.error('Failed to load SwiftLaTeX engine:', error);
        engineLoading = false;
    }
}

/**
 * Compile LaTeX document using SwiftLaTeX
 */
async function compileLatex() {
    if (!engineReady) {
        await initLatexEngine();
        if (!engineReady) {
            throw new Error('LaTeX engine not available');
        }
    }

    const data = collectData();

    // Create virtual filesystem directories
    pdfTexEngine.makeMemFSFolder('config');
    pdfTexEngine.makeMemFSFolder('formats');
    pdfTexEngine.makeMemFSFolder('attachments');
    pdfTexEngine.makeMemFSFolder('enclosures');

    // Write bundled attachment files (like dod-seal.png)
    if (typeof TEXLIVE_ATTACHMENTS !== 'undefined' && Array.isArray(TEXLIVE_ATTACHMENTS)) {
        for (const attachment of TEXLIVE_ATTACHMENTS) {
            // Decode base64 to binary
            const binaryString = atob(attachment.content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            pdfTexEngine.writeMemFSFile(`attachments/${attachment.filename}`, bytes);
            console.log(`Wrote attachment: ${attachment.filename}`);
        }
    }

    // Note: Enclosure PDFs are merged by JavaScript after compilation
    // SwiftLaTeX doesn't support \includepdf for external PDFs

    // Test with minimal document first (for debugging)
    // Set to true to test basic compilation without complex packages
    const USE_MINIMAL_TEST = false; // Full template mode

    if (USE_MINIMAL_TEST) {
        const minimalTex = `\\documentclass{article}
\\begin{document}
Hello World!
\\end{document}`;
        pdfTexEngine.writeMemFSFile('main.tex', minimalTex);
    } else {
        // Write main.tex from templates
        if (window.LATEX_TEMPLATES && window.LATEX_TEMPLATES['main.tex']) {
            pdfTexEngine.writeMemFSFile('main.tex', window.LATEX_TEMPLATES['main.tex']);
        } else {
            throw new Error('LaTeX templates not loaded');
        }
    }

    // Write format files from templates
    for (const [filename, content] of Object.entries(window.LATEX_TEMPLATES)) {
        if (filename.startsWith('formats/')) {
            pdfTexEngine.writeMemFSFile(filename, content);
        }
    }

    // Generate and write config files dynamically from form data
    pdfTexEngine.writeMemFSFile('config/document.tex', generateDocumentTex(data));
    pdfTexEngine.writeMemFSFile('config/letterhead.tex', generateLetterheadTex(data));
    pdfTexEngine.writeMemFSFile('config/signatory.tex', generateSignatoryTex(data));
    pdfTexEngine.writeMemFSFile('config/references.tex', generateReferencesTex(data));
    pdfTexEngine.writeMemFSFile('config/enclosures.tex', generateEnclosuresTex());
    pdfTexEngine.writeMemFSFile('config/body.tex', generateBodyTex(data));
    pdfTexEngine.writeMemFSFile('config/classification.tex', generateClassificationTex(data));
    pdfTexEngine.writeMemFSFile('config/reference-urls.tex', '% No reference URLs\n');

    // Set main file and compile
    pdfTexEngine.setEngineMainFile('main.tex');

    showStatus('Compiling LaTeX...', 'success');
    const result = await pdfTexEngine.compileLaTeX();

    if (result.status === 0 && result.pdf) {
        return result.pdf;
    } else {
        console.error('LaTeX compilation failed:', result.log);

        // Check for fatal format error - engine needs reset
        if (result.log && result.log.includes('Fatal format file error')) {
            console.warn('Fatal format error detected - engine needs reset');
            throw new Error('ENGINE_RESET_NEEDED');
        }

        // Debug: Show log in UI
        const existingDebug = document.getElementById('latex-debug-log');
        if (existingDebug) existingDebug.remove();

        const debugDiv = document.createElement('pre');
        debugDiv.id = 'latex-debug-log';
        debugDiv.style.whiteSpace = 'pre-wrap';
        debugDiv.style.border = '1px solid red';
        debugDiv.style.padding = '10px';
        debugDiv.style.margin = '10px';
        debugDiv.style.backgroundColor = '#fff0f0';
        debugDiv.textContent = result.log;
        document.querySelector('.container').appendChild(debugDiv);

        throw new Error('LaTeX compilation failed. Check console for details.');
    }
}

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
// ENCLOSURES MANAGEMENT
// =============================================================================

// Store enclosures with optional file attachments
let enclosures = [];

/**
 * Add a new enclosure (manual or with file)
 */
function addEnclosure(title = '', file = null) {
    const enclosure = {
        title: title,
        file: file ? {
            name: file.name,
            size: file.size,
            data: null
        } : null
    };

    enclosures.push(enclosure);
    renderEnclosures();
    updatePreview();

    // If file provided, read it and update preview when ready
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            enclosure.file.data = e.target.result;
            // Trigger PDF preview update to include the new enclosure
            if (engineReady) {
                schedulePdfPreviewUpdate();
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

/**
 * Remove an enclosure
 */
function removeEnclosure(index) {
    enclosures.splice(index, 1);
    renderEnclosures();
    updatePreview();
}

/**
 * Update enclosure title
 */
function updateEnclosureTitle(index, title) {
    enclosures[index].title = title;
    updatePreview();
}

/**
 * Attach file to existing enclosure
 */
function attachFileToEnclosure(index, file) {
    if (file.type !== 'application/pdf') {
        showStatus('Only PDF files are allowed', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        enclosures[index].file = {
            name: file.name,
            size: file.size,
            data: e.target.result
        };
        renderEnclosures();
        // Trigger PDF preview update to include the new enclosure
        if (engineReady) {
            schedulePdfPreviewUpdate();
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Handle file input change for specific enclosure
 */
function handleEnclosureFileChange(event, index) {
    const file = event.target.files[0];
    if (file) {
        attachFileToEnclosure(index, file);
    }
    event.target.value = '';
}

/**
 * Handle file upload from drop zone (creates new enclosures)
 */
function handleEnclFileUpload(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type === 'application/pdf') {
            // Use filename without extension as title
            const title = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
            addEnclosure(title, file);
        } else {
            showStatus('Only PDF files are allowed', 'error');
        }
    }
    event.target.value = '';
}

/**
 * Render the enclosures list
 */
function renderEnclosures() {
    const container = document.getElementById('enclosuresList');

    if (enclosures.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = enclosures.map((encl, index) => `
        <div class="enclosure-item">
            <span class="enclosure-number">(${index + 1})</span>
            <input type="text"
                   class="enclosure-input"
                   value="${escapeHtml(encl.title)}"
                   placeholder="Enclosure title"
                   oninput="updateEnclosureTitle(${index}, this.value)">
            ${encl.file
            ? `<span class="enclosure-file-indicator has-file" title="${escapeHtml(encl.file.name)}">📎 ${escapeHtml(encl.file.name)}</span>`
            : `<button type="button" class="enclosure-attach-btn">
                       📎 Attach
                       <input type="file" accept=".pdf" onchange="handleEnclosureFileChange(event, ${index})">
                   </button>`
        }
            <button type="button" class="enclosure-remove" onclick="removeEnclosure(${index})">×</button>
        </div>
    `).join('');
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Initialize drag and drop for enclosure upload
 */
function initDragDrop() {
    const dropZone = document.getElementById('enclDropZone');
    if (!dropZone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        for (const file of files) {
            if (file.type === 'application/pdf') {
                const title = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
                addEnclosure(title, file);
            }
        }
    });
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
        // Font options
        fontSize: document.getElementById('fontSize').value,
        fontFamily: document.getElementById('fontFamily').value,
        // Letterhead
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
        // Classification
        classLevel: document.getElementById('classLevel').value,
        cuiControlledBy: document.getElementById('cuiControlledBy').value,
        cuiCategory: document.getElementById('cuiCategory').value,
        cuiDissemination: document.getElementById('cuiDissemination').value,
        cuiDistStatement: document.getElementById('cuiDistStatement').value,
        pocEmail: document.getElementById('pocEmail').value,
        classifiedBy: document.getElementById('classifiedBy').value,
        derivedFrom: document.getElementById('derivedFrom').value,
        classReason: document.getElementById('classReason').value,
        declassifyOn: document.getElementById('declassifyOn').value,
        classifiedPocEmail: document.getElementById('classifiedPocEmail').value,
        // Refs/Body
        refs: document.getElementById('refs').value,
        body: document.getElementById('body').value,
        sigFirst: document.getElementById('sigFirst').value,
        sigMiddle: document.getElementById('sigMiddle').value,
        sigLast: document.getElementById('sigLast').value,
        sigRank: document.getElementById('sigRank').value,
        sigTitle: document.getElementById('sigTitle').value
    };
}

/**
 * Show/hide classification fields based on selection
 */
function updateClassFields() {
    const classLevel = document.getElementById('classLevel').value;
    const cuiFields = document.getElementById('cuiFields');
    const classifiedFields = document.getElementById('classifiedFields');

    // Hide all first
    cuiFields.style.display = 'none';
    classifiedFields.style.display = 'none';

    // Show appropriate fields
    if (classLevel === 'cui') {
        cuiFields.style.display = 'block';
    } else if (['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(classLevel)) {
        classifiedFields.style.display = 'block';
    }
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

// =============================================================================
// LIVE PREVIEW
// =============================================================================

/**
 * Update the live preview panel
 */
function updatePreview() {
    const data = collectData();
    const refs = parseRefs(data.refs);
    const config = docTypeConfig[data.docType] || docTypeConfig.naval_letter;

    // Classification banners (top and bottom)
    const bannerTop = document.getElementById('prev-class-banner-top');
    const bannerBottom = document.getElementById('prev-class-banner-bottom');
    const cuiBlock = document.getElementById('prev-cui-block');
    const classifiedBlock = document.getElementById('prev-classified-block');

    // Reset all classification elements
    bannerTop.style.display = 'none';
    bannerBottom.style.display = 'none';
    cuiBlock.style.display = 'none';
    classifiedBlock.style.display = 'none';
    bannerTop.className = 'class-banner';
    bannerBottom.className = 'class-banner class-banner-bottom';

    if (data.classLevel === 'cui') {
        // CUI marking
        bannerTop.style.display = 'block';
        bannerBottom.style.display = 'block';
        bannerTop.textContent = 'CUI';
        bannerBottom.textContent = 'CUI';
        bannerTop.classList.add('cui');
        bannerBottom.classList.add('cui');
        // CUI designation block
        cuiBlock.style.display = 'block';
        document.getElementById('prev-cui-controlled').textContent = data.cuiControlledBy;
        document.getElementById('prev-cui-category').textContent = data.cuiCategory;
        document.getElementById('prev-cui-dissem').textContent = data.cuiDissemination;
        document.getElementById('prev-cui-poc').textContent = data.pocEmail;
        document.getElementById('prev-cui-dist').textContent = data.cuiDistStatement;
    } else if (data.classLevel === 'confidential') {
        bannerTop.style.display = 'block';
        bannerBottom.style.display = 'block';
        bannerTop.textContent = 'CONFIDENTIAL';
        bannerBottom.textContent = 'CONFIDENTIAL';
        bannerTop.classList.add('confidential');
        bannerBottom.classList.add('confidential');
        classifiedBlock.style.display = 'block';
        document.getElementById('prev-class-by').textContent = data.classifiedBy;
        document.getElementById('prev-derived-from').textContent = data.derivedFrom;
        document.getElementById('prev-class-reason').textContent = data.classReason;
        document.getElementById('prev-declassify-on').textContent = data.declassifyOn;
        document.getElementById('prev-class-poc').textContent = data.classifiedPocEmail;
    } else if (data.classLevel === 'secret') {
        bannerTop.style.display = 'block';
        bannerBottom.style.display = 'block';
        bannerTop.textContent = 'SECRET';
        bannerBottom.textContent = 'SECRET';
        bannerTop.classList.add('secret');
        bannerBottom.classList.add('secret');
        classifiedBlock.style.display = 'block';
        document.getElementById('prev-class-by').textContent = data.classifiedBy;
        document.getElementById('prev-derived-from').textContent = data.derivedFrom;
        document.getElementById('prev-class-reason').textContent = data.classReason;
        document.getElementById('prev-declassify-on').textContent = data.declassifyOn;
        document.getElementById('prev-class-poc').textContent = data.classifiedPocEmail;
    } else if (data.classLevel === 'top_secret') {
        bannerTop.style.display = 'block';
        bannerBottom.style.display = 'block';
        bannerTop.textContent = 'TOP SECRET';
        bannerBottom.textContent = 'TOP SECRET';
        bannerTop.classList.add('top-secret');
        bannerBottom.classList.add('top-secret');
        classifiedBlock.style.display = 'block';
        document.getElementById('prev-class-by').textContent = data.classifiedBy;
        document.getElementById('prev-derived-from').textContent = data.derivedFrom;
        document.getElementById('prev-class-reason').textContent = data.classReason;
        document.getElementById('prev-declassify-on').textContent = data.declassifyOn;
        document.getElementById('prev-class-poc').textContent = data.classifiedPocEmail;
    } else if (data.classLevel === 'top_secret_sci') {
        bannerTop.style.display = 'block';
        bannerBottom.style.display = 'block';
        bannerTop.textContent = 'TOP SECRET//SCI';
        bannerBottom.textContent = 'TOP SECRET//SCI';
        bannerTop.classList.add('top-secret-sci');
        bannerBottom.classList.add('top-secret-sci');
        classifiedBlock.style.display = 'block';
        document.getElementById('prev-class-by').textContent = data.classifiedBy;
        document.getElementById('prev-derived-from').textContent = data.derivedFrom;
        document.getElementById('prev-class-reason').textContent = data.classReason;
        document.getElementById('prev-declassify-on').textContent = data.declassifyOn;
        document.getElementById('prev-class-poc').textContent = data.classifiedPocEmail;
    }

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

    // Enclosures (using global enclosures array)
    const enclBlock = document.getElementById('prev-encl-block');
    if (enclosures.length > 0) {
        enclBlock.style.display = 'block';
        document.getElementById('prev-encls').innerHTML = enclosures.map((e, i) => `(${i + 1}) ${e.title || 'Untitled'}`).join('<br>');
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

    // Schedule PDF preview update (debounced)
    if (engineReady) {
        schedulePdfPreviewUpdate();
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

% Font options
\\setFontSize{${data.fontSize || '12pt'}}
\\setFontFamily{${data.fontFamily || 'courier'}}

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
    const fullName = getFullSignature(data);
    const abbrevName = getAbbrevSignature(data);

    return `%=============================================================================
% SIGNATURE CONFIGURATION - Generated by libo-secured
%=============================================================================

\\setSignatory
    {${escapeLatex(data.sigFirst)}}
    {${escapeLatex(data.sigMiddle)}}
    {${escapeLatex(data.sigLast)}}
    {${escapeLatex(data.sigRank)}}
    {${escapeLatex(data.sigTitle)}}

\\setSignatoryName{${escapeLatex(fullName)}}
\\setSignatoryAbbrev{${escapeLatex(abbrevName)}}

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
 * Generate config/enclosures.tex (uses global enclosures array)
 * Note: We always pass empty filename because SwiftLaTeX doesn't support \includepdf.
 * For enclosures WITH files: LaTeX creates placeholder, JS replaces with actual PDF.
 * For enclosures WITHOUT files: LaTeX creates placeholder page only.
 */
function generateEnclosuresTex() {
    if (enclosures.length === 0) return '% No enclosures\n';
    return `%=============================================================================
% ENCLOSURES - Generated by libo-secured
% Note: PDF files are merged by JavaScript (SwiftLaTeX doesn't support \\includepdf)
%=============================================================================

${enclosures.map((e, i) => {
    // Always pass empty filename - LaTeX creates placeholder pages
    // JS will replace placeholder pages with actual PDFs for those with files
    return `\\enclosure{${i + 1}}{}{${escapeLatex(e.title || 'Untitled')}}`;
}).join('\n')}
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

/**
 * Generate config/classification.tex
 */
function generateClassificationTex(data) {
    if (data.classLevel === 'unclassified') {
        return `%=============================================================================
% CLASSIFICATION CONFIGURATION - Generated by libo-secured
%=============================================================================
% Document is UNCLASSIFIED - no markings required
`;
    }

    if (data.classLevel === 'cui') {
        return `%=============================================================================
% CLASSIFICATION CONFIGURATION - Generated by libo-secured
%=============================================================================
% CUI Configuration per DoDI 5200.48

\\setClassification{CUI}
\\setCUIControlledBy{${escapeLatex(data.cuiControlledBy)}}
\\setCUICategory{${escapeLatex(data.cuiCategory)}}
\\setCUIDissemination{${escapeLatex(data.cuiDissemination)}}
\\setCUIDistStatement{${escapeLatex(data.cuiDistStatement)}}
\\setPOC{${escapeLatex(data.pocEmail)}}
`;
    }

    // Classified documents
    const classLevelMap = {
        'confidential': 'CONFIDENTIAL',
        'secret': 'SECRET',
        'top_secret': 'TOP SECRET',
        'top_secret_sci': 'TOP SECRET//SCI'
    };

    return `%=============================================================================
% CLASSIFICATION CONFIGURATION - Generated by libo-secured
%=============================================================================
% WARNING: Only process classified documents on systems authorized
% for that classification level.

\\setClassification{${classLevelMap[data.classLevel] || 'SECRET'}}
\\setClassifiedBy{${escapeLatex(data.classifiedBy)}}
\\setDerivedFrom{${escapeLatex(data.derivedFrom)}}
\\setDeclassifyOn{${escapeLatex(data.declassifyOn)}}
\\setClassificationReason{${escapeLatex(data.classReason)}}
\\setPOC{${escapeLatex(data.classifiedPocEmail)}}
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
    configFolder.file('enclosures.tex', generateEnclosuresTex());
    configFolder.file('body.tex', generateBodyTex(data));
    configFolder.file('classification.tex', generateClassificationTex(data));
    configFolder.file('reference-urls.tex', '% No reference URLs\n');

    // Add enclosure PDF files
    const enclosuresWithFiles = enclosures.filter(e => e.file && e.file.data);
    if (enclosuresWithFiles.length > 0) {
        const enclosuresFolder = zip.folder('enclosures');
        for (const encl of enclosuresWithFiles) {
            enclosuresFolder.file(encl.file.name, encl.file.data);
        }
    }

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
 * Quick PDF using jsPDF with pdf-lib for merging enclosures
 */
async function downloadPDF() {
    try {
        const { jsPDF } = window.jspdf;
        const { PDFDocument } = PDFLib;
        const data = collectData();
        const refs = parseRefs(data.refs);
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

        // Encls (using global enclosures array)
        if (enclosures.length > 0) {
            enclosures.forEach((e, i) => {
                pdf.text((i === 0 ? 'Encl:   ' : '        ') + `(${i + 1}) ${e.title || 'Untitled'}`, MARGIN_LEFT, y);
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

        // Get enclosures with attached PDF files
        const enclosuresWithFiles = enclosures.filter(e => e.file && e.file.data);

        if (enclosuresWithFiles.length > 0) {
            // Use pdf-lib to merge main document with enclosure PDFs
            showStatus('Merging enclosure PDFs...', 'success');

            // Get main document as ArrayBuffer
            const mainPdfBytes = pdf.output('arraybuffer');

            // Create merged PDF
            const mergedPdf = await PDFDocument.create();

            // Load and copy main document pages
            const mainDoc = await PDFDocument.load(mainPdfBytes);
            const mainPages = await mergedPdf.copyPages(mainDoc, mainDoc.getPageIndices());
            mainPages.forEach(page => mergedPdf.addPage(page));

            // Append each enclosure PDF
            for (const encl of enclosuresWithFiles) {
                try {
                    const enclDoc = await PDFDocument.load(encl.file.data);
                    const enclPages = await mergedPdf.copyPages(enclDoc, enclDoc.getPageIndices());
                    enclPages.forEach(page => mergedPdf.addPage(page));
                } catch (enclError) {
                    console.warn(`Could not merge enclosure "${encl.title}":`, enclError);
                }
            }

            // Save merged PDF
            const mergedPdfBytes = await mergedPdf.save();
            const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'correspondence.pdf';
            a.click();
            URL.revokeObjectURL(url);

            showStatus(`PDF downloaded with ${enclosuresWithFiles.length} enclosure(s) attached!`, 'success');
        } else {
            // No enclosure PDFs to merge, just save the main document
            pdf.save('correspondence.pdf');
            showStatus('Quick PDF downloaded!', 'success');
        }
    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
    }
}

/**
 * Download PDF compiled using SwiftLaTeX (proper LaTeX formatting)
 * Enclosure PDFs are merged by JavaScript with proper formatting overlays.
 */
async function downloadLatexPDF(retryAfterReset = false) {
    try {
        showStatus('Compiling LaTeX...', 'success');

        // Compile LaTeX document
        const pdfBytes = await compileLatex();

        // Merge enclosure PDFs
        const finalPdfBytes = await mergeEnclosurePdfs(pdfBytes);

        // Download the compiled PDF
        const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'correspondence.pdf';
        a.click();
        URL.revokeObjectURL(url);

        const enclCount = enclosures.filter(e => e.file && e.file.data).length;
        if (enclCount > 0) {
            showStatus(`LaTeX PDF downloaded with ${enclCount} enclosure(s)!`, 'success');
        } else {
            showStatus('LaTeX PDF downloaded!', 'success');
        }
    } catch (error) {
        console.error('LaTeX compilation error:', error);

        // Auto-recover from fatal format errors by resetting engine
        if (error.message === 'ENGINE_RESET_NEEDED' && !retryAfterReset) {
            console.log('Auto-recovering from fatal format error...');
            showStatus('Resetting engine and retrying...', 'success');
            await resetLatexEngine();
            // Retry once after reset
            return downloadLatexPDF(true);
        }

        showStatus('LaTeX compilation failed: ' + error.message, 'error');
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
// ENCLOSURE PDF MERGING
// =============================================================================

/**
 * Merge enclosure PDFs into the main document with proper formatting.
 * Since SwiftLaTeX doesn't support \includepdf, we use pdf-lib to:
 * 1. Remove placeholder pages for enclosures with attached PDFs
 * 2. Append the actual PDF pages with formatting overlays
 */
async function mergeEnclosurePdfs(mainPdfBytes) {
    const enclosuresWithFiles = enclosures.filter(e => e.file && e.file.data);

    if (enclosuresWithFiles.length === 0) {
        return mainPdfBytes;
    }

    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const data = collectData();

    // Load the main document
    const mainDoc = await PDFDocument.load(mainPdfBytes);
    const mainPageCount = mainDoc.getPageCount();

    // Count placeholder pages to remove (one per enclosure with file)
    // Placeholder pages are at the end, one per enclosure with a file
    const placeholderCount = enclosuresWithFiles.length;

    // Create output document
    const outputDoc = await PDFDocument.create();

    // Copy main document pages except placeholder pages at the end
    const pagesToCopy = mainPageCount - placeholderCount;
    if (pagesToCopy > 0) {
        const mainPages = await outputDoc.copyPages(mainDoc,
            Array.from({ length: pagesToCopy }, (_, i) => i));
        mainPages.forEach(page => outputDoc.addPage(page));
    }

    // Embed font for overlays
    const courierFont = await outputDoc.embedFont(StandardFonts.Courier);

    // Letter paper dimensions (8.5 x 11 inches in points)
    const pageWidth = 612;
    const pageHeight = 792;

    // Process each enclosure with a file
    let enclIndex = 0;
    for (let i = 0; i < enclosures.length; i++) {
        const encl = enclosures[i];
        if (!encl.file || !encl.file.data) continue;

        enclIndex++;

        try {
            const enclDoc = await PDFDocument.load(encl.file.data);
            const enclPageCount = enclDoc.getPageCount();

            // Copy each page from enclosure
            for (let pageNum = 0; pageNum < enclPageCount; pageNum++) {
                // Create a new page
                const newPage = outputDoc.addPage([pageWidth, pageHeight]);

                // Embed the enclosure page (scaled to 85% within margins)
                const [embeddedPage] = await outputDoc.embedPdf(enclDoc, [pageNum]);
                const { width: origWidth, height: origHeight } = embeddedPage;

                // Calculate scaling to fit within border area (approx 85% of page)
                const maxWidth = pageWidth * 0.78;
                const maxHeight = pageHeight * 0.72;
                const scale = Math.min(maxWidth / origWidth, maxHeight / origHeight, 0.85);

                const scaledWidth = origWidth * scale;
                const scaledHeight = origHeight * scale;

                // Center the content
                const xOffset = (pageWidth - scaledWidth) / 2;
                const yOffset = (pageHeight - scaledHeight) / 2 - 20; // Shift down slightly

                // Draw border
                newPage.drawRectangle({
                    x: xOffset - 5,
                    y: yOffset - 5,
                    width: scaledWidth + 10,
                    height: scaledHeight + 10,
                    borderColor: rgb(0, 0, 0),
                    borderWidth: 1,
                });

                // Draw the embedded page
                newPage.drawPage(embeddedPage, {
                    x: xOffset,
                    y: yOffset,
                    width: scaledWidth,
                    height: scaledHeight,
                });

                // Add header (CUI marking if applicable)
                if (data.classLevel && data.classLevel !== 'unclassified') {
                    const headerText = data.classLevel === 'cui' ? 'CUI' : data.classLevel.toUpperCase().replace('_', ' ');
                    const headerWidth = courierFont.widthOfTextAtSize(headerText, 12);
                    newPage.drawText(headerText, {
                        x: (pageWidth - headerWidth) / 2,
                        y: pageHeight - 30,
                        size: 12,
                        font: courierFont,
                        color: rgb(0, 0, 0),
                    });
                }

                // Add footer with page number and enclosure label
                const pageLabel = `Enclosure (${i + 1}) - Page ${pageNum + 1} of ${enclPageCount}`;
                const pageLabelWidth = courierFont.widthOfTextAtSize(pageLabel, 10);
                newPage.drawText(pageLabel, {
                    x: (pageWidth - pageLabelWidth) / 2,
                    y: 30,
                    size: 10,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });

                // Add enclosure label in bottom right
                const enclLabel = `Encl (${i + 1})`;
                newPage.drawText(enclLabel, {
                    x: pageWidth - 72 - courierFont.widthOfTextAtSize(enclLabel, 10),
                    y: 50,
                    size: 10,
                    font: courierFont,
                    color: rgb(0, 0, 0),
                });
            }
        } catch (enclError) {
            console.warn(`Could not merge enclosure "${encl.title}":`, enclError);
        }
    }

    return await outputDoc.save();
}

// =============================================================================
// PDF PREVIEW
// =============================================================================

// Debounce timer for PDF preview
let pdfPreviewTimer = null;
let currentPdfUrl = null;

/**
 * Update the PDF preview status message
 */
function setPdfPreviewStatus(message, type = 'loading') {
    const statusEl = document.getElementById('pdfPreviewStatus');
    if (statusEl) {
        statusEl.className = 'pdf-preview-status' + (type !== 'loading' ? ' ' + type : '');
        statusEl.innerHTML = type === 'loading'
            ? `<span class="pdf-loading">${message}</span>`
            : message;
        statusEl.classList.remove('hidden');
    }
}

/**
 * Hide the PDF preview status
 */
function hidePdfPreviewStatus() {
    const statusEl = document.getElementById('pdfPreviewStatus');
    if (statusEl) {
        statusEl.classList.add('hidden');
    }
}

/**
 * Compile and display PDF in the preview iframe
 * Note: Enclosure PDFs are now embedded by LaTeX via \includepdf, not merged by JS.
 */
async function updatePdfPreview(retryAfterReset = false) {
    const frame = document.getElementById('pdfPreviewFrame');
    if (!frame) return;

    try {
        setPdfPreviewStatus('Compiling LaTeX...', 'loading');

        // Compile LaTeX document
        const pdfBytes = await compileLatex();

        // Merge enclosure PDFs if any
        const finalPdfBytes = await mergeEnclosurePdfs(pdfBytes);

        // Revoke previous blob URL to free memory
        if (currentPdfUrl) {
            URL.revokeObjectURL(currentPdfUrl);
        }

        // Create blob URL for the PDF
        const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
        currentPdfUrl = URL.createObjectURL(blob);

        // Display in iframe
        frame.src = currentPdfUrl;

        // Hide status after successful compilation
        hidePdfPreviewStatus();

    } catch (error) {
        console.error('PDF preview error:', error);

        // Auto-recover from fatal format errors by resetting engine
        if (error.message === 'ENGINE_RESET_NEEDED' && !retryAfterReset) {
            console.log('Auto-recovering from fatal format error...');
            setPdfPreviewStatus('Resetting engine...', 'loading');
            await resetLatexEngine();
            // Retry once after reset
            return updatePdfPreview(true);
        }

        setPdfPreviewStatus('Compilation failed: ' + error.message, 'error');
    }
}

/**
 * Debounced PDF preview update
 * Waits 1.5 seconds after last change before recompiling
 */
function schedulePdfPreviewUpdate() {
    if (pdfPreviewTimer) {
        clearTimeout(pdfPreviewTimer);
    }
    setPdfPreviewStatus('Waiting for changes...', 'loading');
    pdfPreviewTimer = setTimeout(updatePdfPreview, 1500);
}

/**
 * Force refresh the PDF preview immediately
 */
function refreshPdfPreview() {
    if (pdfPreviewTimer) {
        clearTimeout(pdfPreviewTimer);
        pdfPreviewTimer = null;
    }
    updatePdfPreview();
}

/**
 * Initialize PDF preview on engine ready
 */
async function initPdfPreview() {
    setPdfPreviewStatus('Initializing LaTeX engine...', 'loading');

    try {
        await initLatexEngine();
        if (engineReady) {
            setPdfPreviewStatus('Engine ready. Compiling...', 'loading');
            await updatePdfPreview();
        } else {
            setPdfPreviewStatus('LaTeX engine unavailable', 'error');
        }
    } catch (error) {
        console.error('Failed to initialize PDF preview:', error);
        setPdfPreviewStatus('Failed to initialize: ' + error.message, 'error');
    }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    // Load data files
    loadSSICData();
    loadUnitData();

    // Initialize drag-drop for PDF uploads
    initDragDrop();

    // Initialize PDF preview (this replaces updatePreview for initial load)
    initPdfPreview();
});
