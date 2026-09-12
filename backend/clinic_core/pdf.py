"""
PDF rendering that works inside a container.

WHY THIS EXISTS. `frappe.get_print()` emits a document whose <head> links the
desk asset bundles by ROOT-RELATIVE path:

    <link rel="stylesheet" href="/assets/frappe/dist/css/print.bundle.*.css">
    <script src="/assets/frappe/dist/js/print.bundle.*.js"></script>

wkhtmltopdf is handed that HTML as a string, with no base URL, so a leading "/"
has no protocol to resolve against. It aborts the whole render with

    Exit with code 1 due to network error: ProtocolUnknownError

and produces no output -- which Frappe then reports as the thoroughly
misleading "PDF generation failed because of broken image links", despite the
document containing no images at all.

Injecting <base href="..."> does not help either: the container cannot reach its
own public URL, so every asset 404s and wkhtmltopdf fails with
ContentNotFoundError instead.

The fix is to drop those two external references. Print formats inline the
styles they actually need, so the rendered PDF is unchanged -- the bundles only
matter for the browser preview. Verified on this deployment: the same invoice
that failed renders to 25KB once they are stripped.
"""

import re

import frappe

_STYLESHEET = re.compile(r"""<link\b[^>]*\brel=["']stylesheet["'][^>]*>""", re.I)
_SCRIPT_SRC = re.compile(r"""<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*</script>""", re.I)


def strip_external_assets(html):
    """Remove <link rel=stylesheet> and <script src=...> from print HTML.

    Inline <style> and <script> blocks are left alone: those carry the print
    format's own styling and the barcode renderer, and neither needs the network.
    """
    html = _STYLESHEET.sub("", html or "")
    return _SCRIPT_SRC.sub("", html)


def render_pdf(html, options=None):
    """PDF bytes from print HTML, with the container caveat handled."""
    from frappe.utils.pdf import get_pdf

    return get_pdf(strip_external_assets(html), options=options)


def print_pdf(doctype, name, print_format=None, letterhead=None):
    """One document as PDF bytes."""
    html = frappe.get_print(
        doctype, name, print_format=print_format, letterhead=letterhead, as_pdf=False
    )
    return render_pdf(html)


def print_many_pdf(doctype, names, print_format=None):
    """Several documents as ONE PDF, each starting on its own page."""
    parts = [
        frappe.get_print(doctype, n, print_format=print_format, as_pdf=False)
        for n in names
    ]
    joined = '<div style="page-break-after: always;"></div>'.join(parts)
    return render_pdf(joined)
