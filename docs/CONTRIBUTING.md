# Contributing to DonDocs

Thank you for your interest in contributing to DonDocs! This document provides guidelines and instructions for contributing.

**Official Repository:** [https://github.com/marinecoders/dondocs](https://github.com/marinecoders/dondocs)

All contributions should be made to the Marine Coders organization repository, which is the official community open source location for DonDocs.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Coding Standards](#coding-standards)
  - [LaTeX Spacing Standards](#latex-spacing-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Issue Guidelines](#issue-guidelines)

---

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help maintain a welcoming environment for all contributors

---

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Git
- Basic knowledge of React, TypeScript, and LaTeX (for template work)

### Fork and Clone

1. Fork the [Marine Coders repository](https://github.com/marinecoders/dondocs) on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/dondocs.git
   cd dondocs
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/marinecoders/dondocs.git
   ```

---

## Development Setup

### Install Dependencies

```bash
npm install
```

### Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

### Lint Code

```bash
npm run lint
```

---

## Project Structure

```
dondocs/
├── tex/                          # LaTeX source templates
│   ├── main.tex                  # Main template with base commands
│   └── templates/                # Document type templates
├── public/
│   ├── attachments/              # Seal images
│   └── lib/
│       ├── PdfTeXEngine.js       # SwiftLaTeX WebAssembly engine
│       ├── latex-templates.js    # LaTeX templates as JS
│       └── texlive/              # TeX Live packages
├── src/
│   ├── components/
│   │   ├── editor/               # Form components
│   │   ├── layout/               # Page layout
│   │   ├── modals/               # Modal dialogs
│   │   └── ui/                   # shadcn/ui components
│   ├── data/
│   │   ├── templates/            # Content templates (TypeScript)
│   │   ├── units/                # Unit directory data
│   │   ├── ssic/                 # SSIC codes
│   │   └── references/           # Reference data
│   ├── hooks/                    # Custom React hooks
│   ├── lib/                      # Utility libraries
│   ├── services/
│   │   ├── docx/                 # Word generation
│   │   ├── latex/                # LaTeX generation
│   │   ├── pdf/                  # PDF post-processing
│   │   └── pii/                  # PII detection
│   ├── stores/                   # Zustand state stores
│   └── types/                    # TypeScript types
├── docs/                         # Documentation
└── Makefile                      # Build commands
```

### Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app component, debounced preview |
| `src/stores/documentStore.ts` | Document state management |
| `src/services/latex/generator.ts` | Generates .tex files from state |
| `src/services/latex/escaper.ts` | Escapes LaTeX special characters |
| `public/lib/latex-templates.js` | All LaTeX templates |
| `src/hooks/useLatexEngine.ts` | SwiftLaTeX engine management |
| `src/services/pdf/mergeEnclosures.ts` | PDF post-processing |

---

## Making Changes

### Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### Branch Naming Convention

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Adding or updating tests

### Keep Your Fork Updated

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

---

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Define explicit types for function parameters and return values
- Use interfaces for object shapes
- Avoid `any` unless absolutely necessary

```typescript
// Good
function formatDate(date: Date): string {
  return format(date, 'd MMM yy');
}

// Avoid
function formatDate(date: any) {
  return format(date, 'd MMM yy');
}
```

### React Components

- Use functional components with hooks
- Keep components focused and single-purpose
- Extract reusable logic into custom hooks
- Use descriptive names for components and props

```typescript
// Good
interface DocumentHeaderProps {
  title: string;
  classification?: ClassificationLevel;
}

export function DocumentHeader({ title, classification }: DocumentHeaderProps) {
  // ...
}
```

### State Management

- Use Zustand stores for global state
- Keep store actions focused
- Use selectors to prevent unnecessary re-renders

```typescript
// Good - using selectors
const docType = useDocumentStore((state) => state.formData.docType);

// Avoid - subscribing to entire store
const { formData } = useDocumentStore();
```

### Styling

- Use Tailwind CSS for styling
- Follow the existing color scheme and design patterns
- Use shadcn/ui components where appropriate
- Support both dark and light themes

### Comments

- Write self-documenting code where possible
- Add comments for complex logic
- Document SECNAV/MCO references for compliance-related code
- Use JSDoc for public APIs

```typescript
/**
 * Escapes special LaTeX characters in user input.
 * Per SECNAV M-5216.5, certain characters must be preserved.
 */
export function escapeLatex(text: string): string {
  // ...
}
```

### LaTeX Spacing Standards

All vertical spacing **must** use `\vspace{<length>}`. No exceptions.

Do not use `\\[Xpt]`, `\medskip`, `\bigskip`, `\smallskip`, `\baselineskip`, or bare blank lines as substitutes.

#### Allowed Values

| Value | Meaning | When to use |
|-------|---------|-------------|
| `\vspace{12pt}` | One blank line | Between paragraphs, before Ref/Encl, after SSIC, after date, section breaks |
| `\vspace{6pt}` | Half line | Between subparagraphs |
| `\vspace{24pt}` | Two blank lines | Before signature blocks, CUI/classification banners, endorsement separators |
| `\vspace{48pt}` | Four lines | Gap between closing ("Very respectfully,") and typed signature name |

#### Banned Alternatives

| Don't use | Why |
|-----------|-----|
| `\\[12pt]` | Forces a line break first, then adds space -- different behavior than `\vspace` |
| `\baselineskip` | ~14.4pt at 12pt font, not 12pt. Drifts with font size changes |
| `\vspace{\baselineskip}` | Same problem, just wrapped in `\vspace` |
| `\medskip` | Relative to document class, not a fixed value |
| `\bigskip` / `\smallskip` | Same -- relative, not fixed |
| blank lines | Depends on `\parskip` setting, unpredictable |

#### In `.tex` templates

```latex
% Good
\vspace{12pt}
\vspace{6pt}
\vspace{24pt}

% Bad
\\[12pt]
\medskip
\vspace{\baselineskip}
```

#### In TypeScript generators

Same rule applies to `flat-generator.ts`, `generator.ts`, and `latex-templates.js`:

```typescript
// Good
lines.push('\\vspace{12pt}');

// Bad
lines.push('\\medskip');
lines.push('\\\\[12pt]');
lines.push('\\vspace{\\baselineskip}');
```

If you find existing code using non-standard spacing, fix it in your PR or file an issue.

#### SECNAV Reference

Per SECNAV M-5216.5 Ch 7 Para 13:
- **Within paragraphs:** Single spaced
- **Between paragraphs:** Double spaced (one blank line = `\vspace{12pt}`)
- **Between subparagraphs:** Not specified by the manual; use `\vspace{6pt}` for visual distinction

---

## Testing

### Manual Testing Checklist

Before submitting changes, test:

1. **Document Types** - Verify document types render correctly (Naval Letter, endorsements, memoranda, agreements, executive)
2. **PDF Generation** - Check that PDFs generate without errors
3. **References & Enclosures** - Test adding, removing, reordering
4. **Classification** - Test CUI and classified markings
5. **Profiles** - Test saving and loading profiles
6. **Mobile** - Check responsive layout on small screens
7. **Dark/Light Mode** - Verify both themes work

### Testing LaTeX Changes

1. Start the dev server
2. Select the affected document type
3. Fill in all fields
4. Check the PDF preview
5. Download and verify the PDF

### Console Debugging

Use these console commands for debugging:

```javascript
// View TeX Live file requests
DONDOCS.texlive.summary()

// Check LaTeX engine status
// (errors appear in console during compilation)
```

---

## Submitting Changes

### Commit Messages

Write clear, descriptive commit messages:

```
Add support for joint memorandum format

- Implement dual signature block per SECNAV Ch 7
- Add junior command configuration
- Update generator.ts for joint document types

Co-Authored-By: Claude <noreply@anthropic.com>
```

Format:
- First line: Brief summary (50 chars or less)
- Blank line
- Body: Detailed explanation if needed
- Reference issues: "Fixes #123" or "Closes #456"

### Pull Request Process

1. **Update your branch** with the latest main:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your branch**:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create a Pull Request** on GitHub with:
   - Clear title describing the change
   - Description of what changed and why
   - Screenshots for UI changes
   - Reference to related issues

4. **PR Template**:
   ```markdown
   ## Summary
   Brief description of changes

   ## Changes
   - Change 1
   - Change 2

   ## Test Plan
   - [ ] Tested document type X
   - [ ] Verified PDF generation
   - [ ] Checked mobile layout

   ## Screenshots
   (if applicable)

   ## Related Issues
   Fixes #123
   ```

5. **Address Review Feedback** - Make requested changes and push updates

---

## Issue Guidelines

### Reporting Bugs

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Browser and OS information
- Screenshots if applicable
- Console errors if any

### Requesting Features

Include:
- Clear description of the feature
- Use case / why it's needed
- SECNAV/MCO reference if compliance-related
- Mockups or examples if applicable

### Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or improvement
- `documentation` - Documentation updates
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed

---

## Types of Contributions

### Documentation

- Fix typos or clarify existing docs
- Add examples or tutorials
- Translate documentation

### Bug Fixes

- Fix issues from the issue tracker
- Improve error handling
- Fix edge cases

### Features

- Add new document types (see [CREATING_TEMPLATES.md](./CREATING_TEMPLATES.md))
- Enhance existing functionality
- Improve accessibility

### Data

- Add/update unit directory entries
- Add/update SSIC codes
- Add content templates (see [CREATING_TEMPLATES.md](./CREATING_TEMPLATES.md))

### Templates

There are two types of templates in DonDocs:

1. **Content Templates** (`src/data/templates/`) - TypeScript files that define pre-filled document content (subject lines, paragraphs, references). Most contributors work here. No LaTeX knowledge required.

2. **Format Templates** (`tex/templates/`) - LaTeX files that define document layouts (date placement, signature blocks, page styles). Rarely need modification.

### Performance

- Optimize LaTeX compilation
- Reduce bundle size
- Improve load times

---

## Need Help?

- Check existing issues and discussions
- Read the documentation in `/docs`
- Open a new issue with your question

---

## Recognition

Contributors are recognized in:
- Git commit history
- Pull request acknowledgments
- Project documentation (for significant contributions)

Thank you for contributing to DonDocs!

---

*Semper Fidelis*
