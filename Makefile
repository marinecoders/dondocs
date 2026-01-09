#=============================================================================
# USMC CORRESPONDENCE TEMPLATE - Makefile
#=============================================================================

# Main document name (without .tex extension)
MAIN = main

# LaTeX compiler
LATEX = pdflatex
LATEXMK = latexmk

# TeX Live package manager
TLMGR = sudo tlmgr

#-----------------------------------------------------------------------------
# Default target
#-----------------------------------------------------------------------------
.PHONY: all
all: pdf

#-----------------------------------------------------------------------------
# Install required LaTeX packages
#-----------------------------------------------------------------------------
.PHONY: install
install:
	@echo "Installing required LaTeX packages..."
	$(TLMGR) update --self
	$(TLMGR) install \
		enumitem \
		fancyhdr \
		geometry \
		hyperref \
		lastpage \
		parskip \
		pdfpages \
		setspace \
		textpos \
		xcolor \
		graphics \
		tools
	@echo "Done! All packages installed."
	@echo ""
	@echo "NOTE: For digital signature fields, install AcroTeX manually:"
	@echo "      https://www.math.uakron.edu/~dpstory/acrotex.html"

#-----------------------------------------------------------------------------
# Info about digital signatures
#-----------------------------------------------------------------------------
.PHONY: install-signatures
install-signatures:
	@echo "AcroTeX (eforms) is NOT available via tlmgr."
	@echo ""
	@echo "To enable embedded PDF signature fields:"
	@echo "  1. Download from: https://www.math.uakron.edu/~dpstory/acrotex.html"
	@echo "  2. Follow installation instructions"
	@echo "  3. Uncomment 'eforms' in main.tex"
	@echo ""
	@echo "Alternative: Use Adobe Acrobat to add signature field after compiling."

#-----------------------------------------------------------------------------
# Compile PDF (single pass - fast but may have stale references)
#-----------------------------------------------------------------------------
.PHONY: quick
quick:
	$(LATEX) $(MAIN).tex

#-----------------------------------------------------------------------------
# Compile PDF (two passes - correct page numbers)
#-----------------------------------------------------------------------------
.PHONY: pdf
pdf:
	$(LATEX) $(MAIN).tex
	$(LATEX) $(MAIN).tex
	@echo "Build complete: $(MAIN).pdf"

#-----------------------------------------------------------------------------
# Compile PDF using latexmk (handles all passes automatically)
#-----------------------------------------------------------------------------
.PHONY: build
build:
	$(LATEXMK) -pdf $(MAIN).tex
	@echo "Build complete: $(MAIN).pdf"

#-----------------------------------------------------------------------------
# Watch for changes and recompile (continuous mode)
#-----------------------------------------------------------------------------
.PHONY: watch
watch:
	$(LATEXMK) -pdf -pvc $(MAIN).tex

#-----------------------------------------------------------------------------
# Clean auxiliary files (keep PDF)
#-----------------------------------------------------------------------------
.PHONY: clean
clean:
	@echo "Cleaning auxiliary files..."
	rm -f $(MAIN).aux $(MAIN).log $(MAIN).out $(MAIN).toc
	rm -f $(MAIN).fdb_latexmk $(MAIN).fls $(MAIN).synctex.gz
	rm -f $(MAIN).bbl $(MAIN).blg $(MAIN).nav $(MAIN).snm
	rm -f config/*.aux
	@echo "Clean complete."

#-----------------------------------------------------------------------------
# Clean everything including PDF
#-----------------------------------------------------------------------------
.PHONY: distclean
distclean: clean
	@echo "Removing PDF..."
	rm -f $(MAIN).pdf
	@echo "Distclean complete."

#-----------------------------------------------------------------------------
# View the PDF (macOS)
#-----------------------------------------------------------------------------
.PHONY: view
view:
	open $(MAIN).pdf

#-----------------------------------------------------------------------------
# Full rebuild (clean + build)
#-----------------------------------------------------------------------------
.PHONY: rebuild
rebuild: clean pdf

#=============================================================================
# WEB APPLICATION (React)
#=============================================================================

# Web directory
WEB_DIR = web-react

#-----------------------------------------------------------------------------
# Start development server (default: http://localhost:5173)
# Pulls latest, builds, then starts dev server
#-----------------------------------------------------------------------------
.PHONY: dev
dev:
	@echo "Pulling latest changes..."
	git pull
	@echo "Building web application..."
	$(MAKE) web-build
	@echo "Starting development server..."
	cd $(WEB_DIR) && npm run dev

#-----------------------------------------------------------------------------
# Quick dev - just start dev server without pull/build
#-----------------------------------------------------------------------------
.PHONY: dev-quick
dev-quick: web-install
	@echo "Starting development server..."
	cd $(WEB_DIR) && npm run dev

#-----------------------------------------------------------------------------
# Build web app for production
#-----------------------------------------------------------------------------
.PHONY: web-build
web-build: web-install
	@echo "Building web application..."
	cd $(WEB_DIR) && npm run build
	@echo "Build complete! Output in $(WEB_DIR)/dist/"

#-----------------------------------------------------------------------------
# Install web dependencies
#-----------------------------------------------------------------------------
.PHONY: web-install
web-install:
	@echo "Installing web dependencies..."
	cd $(WEB_DIR) && npm install
	@echo "Dependencies installed."

#-----------------------------------------------------------------------------
# Run linter
#-----------------------------------------------------------------------------
.PHONY: lint
lint: web-install
	cd $(WEB_DIR) && npm run lint

#-----------------------------------------------------------------------------
# Preview production build locally
#-----------------------------------------------------------------------------
.PHONY: preview
preview: web-build
	cd $(WEB_DIR) && npm run preview

#-----------------------------------------------------------------------------
# Expose dev server via ngrok (for mobile/external testing)
# Usage: make ngrok
#        make ngrok NGROK_DOMAIN=your-domain.ngrok-free.dev
#-----------------------------------------------------------------------------
.PHONY: ngrok
ngrok:
	@echo "Starting ngrok tunnel to localhost:5173..."
	@echo "Make sure 'make dev' is running in another terminal!"
ifdef NGROK_DOMAIN
	ngrok http --url=$(NGROK_DOMAIN) 5173
else
	ngrok http 5173
endif

#-----------------------------------------------------------------------------
# Clean web build artifacts
#-----------------------------------------------------------------------------
.PHONY: web-clean
web-clean:
	@echo "Cleaning web build artifacts..."
	rm -rf $(WEB_DIR)/dist
	@echo "Web clean complete."

#-----------------------------------------------------------------------------
# Help
#-----------------------------------------------------------------------------
.PHONY: help
help:
	@echo "USMC Correspondence Template - Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "LaTeX Targets:"
	@echo "  install            Install all required LaTeX packages"
	@echo "  install-signatures Install only AcroTeX (for digital signatures)"
	@echo "  pdf                Compile PDF (2 passes, correct page numbers)"
	@echo "  quick              Compile PDF (1 pass, fast)"
	@echo "  build              Compile using latexmk (auto-detects passes)"
	@echo "  watch              Watch for changes and auto-recompile"
	@echo "  view               Open the PDF (macOS)"
	@echo "  clean              Remove auxiliary files (keep PDF)"
	@echo "  distclean          Remove all generated files including PDF"
	@echo "  rebuild            Clean and rebuild"
	@echo ""
	@echo "Web Targets:"
	@echo "  dev                Pull, build, then start dev server"
	@echo "  dev-quick          Start dev server without pull/build"
	@echo "  web-build          Build for production"
	@echo "  web-install        Install npm dependencies"
	@echo "  lint               Run ESLint"
	@echo "  preview            Preview production build"
	@echo "  ngrok              Expose dev server via ngrok tunnel"
	@echo "  web-clean          Remove web build artifacts"
	@echo ""
	@echo "  help               Show this help message"

