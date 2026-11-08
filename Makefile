# Builds user-guide.pdf (TeX Live with latexmk and pdflatex).
# Screenshots: see capture/README.md.
user-guide.pdf: user-guide.tex amcguide.sty amc-webapp.version screenshots/shots.tex $(wildcard screenshots/*.png)
	latexmk -pdf -interaction=nonstopmode -halt-on-error user-guide.tex

clean:
	latexmk -C user-guide.tex

.PHONY: clean
