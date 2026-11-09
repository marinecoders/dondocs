# Browser development and the standalone example under tex/.
.DEFAULT_GOAL := help
TEX_BUILD_DIR ?= .tex-build
LATEX ?= pdflatex
LATEXMK ?= latexmk

.PHONY: all prepare-tex pdf quick build watch clean distclean view rebuild
.PHONY: dev dev-quick local run web-build web-install lint preview web-clean help
all: pdf
prepare-tex:
	python3 scripts/prepare-tex-example.py --output "$(TEX_BUILD_DIR)"
quick: prepare-tex
	cd "$(TEX_BUILD_DIR)" && $(LATEX) -interaction=nonstopmode -halt-on-error -no-shell-escape main.tex
pdf: quick
	cd "$(TEX_BUILD_DIR)" && $(LATEX) -interaction=nonstopmode -halt-on-error -no-shell-escape main.tex
build: prepare-tex
	cd "$(TEX_BUILD_DIR)" && $(LATEXMK) -pdf -pdflatex="$(LATEX) %O -no-shell-escape %S" main.tex
watch: prepare-tex
	cd "$(TEX_BUILD_DIR)" && $(LATEXMK) -pdf -pdflatex="$(LATEX) %O -no-shell-escape %S" -pvc main.tex
clean:
	rm -f "$(TEX_BUILD_DIR)"/*.aux "$(TEX_BUILD_DIR)"/*.log "$(TEX_BUILD_DIR)"/*.out "$(TEX_BUILD_DIR)"/*.toc "$(TEX_BUILD_DIR)"/*.fls "$(TEX_BUILD_DIR)"/*.fdb_latexmk "$(TEX_BUILD_DIR)"/*.synctex.gz
distclean: clean
	rm -f "$(TEX_BUILD_DIR)/main.pdf"
view:
	open "$(TEX_BUILD_DIR)/main.pdf"
rebuild: clean
	$(MAKE) pdf

dev dev-quick local run:
	npm run dev
web-install:
	npm ci
web-build:
	npm run build
lint:
	npm run lint
preview:
	npm run preview
web-clean:
	rm -rf dist
help:
	@echo "Install web dependencies: make web-install (Node.js 22+)"
	@echo "Web: dev / local / run, web-build, lint, preview, web-clean"
	@echo "TeX example: pdf (two passes), quick, build (latexmk), watch, view (macOS)"
	@echo "TeX output: $(TEX_BUILD_DIR)/main.pdf; clean / distclean / rebuild"
	@echo "Requires Python 3 and a TeX Live installation; see tex/README.md."
