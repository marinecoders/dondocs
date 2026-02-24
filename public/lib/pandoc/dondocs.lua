-- dondocs.lua: Pandoc Lua filter for DOCX output
-- Reads layout proportions from metadata (passed by pandoc-converter.ts)
-- and applies them to table column widths for proper SECNAV M-5216.5 formatting.
--
-- Four-pass filter:
--   Pass 1 (Meta)      → read layout proportions from metadata
--   Pass 2 (Table)     → classify tables and set column widths
--   Pass 3 (RawBlock)  → convert LaTeX spacing commands to DOCX spacing paragraphs
--   Pass 4 (RawInline) → convert LaTeX inline commands to DOCX text
--
-- Table classification logic (by structural analysis):
--   3-col + Image in cell 1    → LETTERHEAD (seal | center | spacer)
--   3-col + no Image           → MOA/JOINT SSIC (equal thirds, or left/spacer/right)
--   2-col + Image in cell 1    → JOINT LETTERHEAD (dual seals, 50/50)
--   2-col + col2=AlignRight    → SSIC (left spacer | right content)
--   2-col + both Left + empty1 → SIGNATURE (indent | content)
--   2-col + both Left + addr   → ADDRESS (label | content) — detected by From/To/Subj labels
--   2-col + both Left + other  → DUAL SIGNATURE (50/50) — joint/MOA dual sig or joint letterhead
--   1-col or other             → FALLBACK (equal widths)

-- Layout proportions (defaults match SECNAV spec on 6.5in text width)
local L = {
  lh_seal    = 0.192,
  lh_center  = 0.615,
  lh_spacer  = 0.192,
  ssic_left  = 0.750,
  ssic_right = 0.250,
  addr_label = 0.077,
  addr_content = 0.923,
  copyto_label = 0.102,
  copyto_content = 0.898,
  sig_left   = 0.500,
  sig_right  = 0.500,
  dual_left  = 0.500,
  dual_right = 0.500,
}

-- Font size in points (passed via metadata; default 12)
-- Used to scale \baselineskip spacing: 1 baselineskip = fontSizePt * 20 twips
local fontSizePt = 12

-- Read a metadata string as a number, with fallback
local function mnum(meta, key, fallback)
  if meta[key] then
    local val = tonumber(pandoc.utils.stringify(meta[key]))
    if val then return val end
  end
  return fallback
end

-- Pass 1: Read layout proportions and font size from document metadata
local function read_meta(meta)
  L.lh_seal      = mnum(meta, "lh-seal",      L.lh_seal)
  L.lh_center    = mnum(meta, "lh-center",     L.lh_center)
  L.lh_spacer    = mnum(meta, "lh-spacer",     L.lh_spacer)
  L.ssic_left    = mnum(meta, "ssic-left",     L.ssic_left)
  L.ssic_right   = mnum(meta, "ssic-right",    L.ssic_right)
  L.addr_label   = mnum(meta, "addr-label",    L.addr_label)
  L.addr_content = mnum(meta, "addr-content",  L.addr_content)
  L.copyto_label   = mnum(meta, "copyto-label",    L.copyto_label)
  L.copyto_content = mnum(meta, "copyto-content",  L.copyto_content)
  L.sig_left     = mnum(meta, "sig-left",      L.sig_left)
  L.sig_right    = mnum(meta, "sig-right",     L.sig_right)
  L.dual_left    = mnum(meta, "dual-sig-left", L.dual_left)
  L.dual_right   = mnum(meta, "dual-sig-right",L.dual_right)
  fontSizePt     = mnum(meta, "font-size-pt",  fontSizePt)
end

-- Helper: check if a table cell is empty
local function is_empty_cell(cell)
  if #cell.contents == 0 then return true end
  for _, block in ipairs(cell.contents) do
    if block.t == "Plain" or block.t == "Para" then
      if #block.content > 0 then return false end
    else
      return false
    end
  end
  return true
end

-- Helper: check if a cell contains an image (identifies letterhead tables)
local function cell_has_image(cell)
  for _, block in ipairs(cell.contents) do
    if block.t == "Plain" or block.t == "Para" then
      for _, inline in ipairs(block.content) do
        if inline.t == "Image" then return true end
      end
    end
  end
  return false
end

-- Helper: check if all first-column cells are empty (identifies signature tables)
local function has_empty_first_column(tbl)
  for _, body in ipairs(tbl.bodies) do
    for _, row in ipairs(body.body) do
      if #row.cells >= 2 and not is_empty_cell(row.cells[1]) then
        return false
      end
    end
  end
  return true
end

-- Helper: check if the first row's first cell has an image
local function is_letterhead_table(tbl)
  for _, body in ipairs(tbl.bodies) do
    for _, row in ipairs(body.body) do
      if #row.cells >= 2 then
        return cell_has_image(row.cells[1])
      end
    end
  end
  return false
end

-- Helper: check if the table is a "Copy to:" block specifically.
-- Copy to tables have "Copy to:" as the first non-empty label in column 1.
-- These get different (wider) label proportions than other address tables
-- to match the PDF auto-fit behavior where "Copy to:" takes more space than "From:".
local function is_copyto_table(tbl)
  for _, body in ipairs(tbl.bodies) do
    for _, row in ipairs(body.body) do
      if #row.cells >= 2 then
        local cell = row.cells[1]
        for _, block in ipairs(cell.contents) do
          if block.t == "Plain" or block.t == "Para" then
            local text = pandoc.utils.stringify(block)
            if text == "Copy to:" then return true end
          end
        end
      end
    end
  end
  return false
end

-- Helper: check if the table has address labels (From:/To:/Subj:/Via:/Ref:/Encl:)
-- Address tables have short labels in the first column like "From:", "To:", etc.
-- This distinguishes address blocks from dual signatures and joint letterheads.
-- Note: "Copy to:" is handled separately by is_copyto_table() for different proportions.
local function is_address_table(tbl)
  local address_labels = {
    ["From:"] = true, ["To:"] = true, ["Subj:"] = true,
    ["Via:"] = true, ["Ref:"] = true, ["Encl:"] = true,
  }
  for _, body in ipairs(tbl.bodies) do
    for _, row in ipairs(body.body) do
      if #row.cells >= 2 then
        local cell = row.cells[1]
        for _, block in ipairs(cell.contents) do
          if block.t == "Plain" or block.t == "Para" then
            -- Get the text content of the first cell
            local text = pandoc.utils.stringify(block)
            -- Check if it matches a known address label
            if address_labels[text] then
              return true
            end
          end
        end
      end
    end
  end
  return false
end

-- Helper: check if a 3-col table is a centered title/letterhead
-- (empty left + right columns with content only in center column)
-- Distinguishes joint letterhead from MOA dual SSIC blocks.
local function is_centered_title_table(tbl)
  if #tbl.colspecs ~= 3 then return false end
  for _, body in ipairs(tbl.bodies) do
    for _, row in ipairs(body.body) do
      if #row.cells >= 3 then
        -- Left and right cells should be empty, center should have content
        if not is_empty_cell(row.cells[1]) then return false end
        if is_empty_cell(row.cells[2]) then return false end
        if not is_empty_cell(row.cells[3]) then return false end
      end
    end
  end
  return true
end

-- Pass 2: Apply layout proportions to tables
local function apply_table(tbl)
  local ncols = #tbl.colspecs
  local new_colspecs = {}

  if ncols == 3 and is_letterhead_table(tbl) then
    -- 3-col letterhead: seal | centered org text | right spacer
    new_colspecs = {
      {tbl.colspecs[1][1], L.lh_seal},
      {pandoc.AlignCenter,  L.lh_center},
      {tbl.colspecs[3][1], L.lh_spacer},
    }

  elseif ncols == 2 then
    local align1 = tbl.colspecs[1][1]
    local align2 = tbl.colspecs[2][1]

    if is_letterhead_table(tbl) then
      -- 2-col letterhead with seal images (dual seal layout)
      new_colspecs = {
        {align1, L.dual_left},
        {align2, L.dual_right},
      }
    elseif align2 == pandoc.AlignRight then
      -- SSIC block: left spacer | right-aligned content
      new_colspecs = {
        {align1, L.ssic_left},
        {align2, L.ssic_right},
      }
    elseif align1 == pandoc.AlignLeft and align2 == pandoc.AlignLeft then
      if has_empty_first_column(tbl) then
        -- Signature block: left spacer | signature content
        new_colspecs = {
          {align1, L.sig_left},
          {align2, L.sig_right},
        }
      elseif is_copyto_table(tbl) then
        -- Copy to block: wider label than address (matches PDF auto-fit for "Copy to:")
        new_colspecs = {
          {align1, L.copyto_label},
          {align2, L.copyto_content},
        }
      elseif is_address_table(tbl) then
        -- Address block: label (From:/To:/Subj:) | content
        new_colspecs = {
          {align1, L.addr_label},
          {align2, L.addr_content},
        }
      else
        -- Dual signature, joint letterhead, or joint address — use equal 50/50 split
        new_colspecs = {
          {align1, L.dual_left},
          {align2, L.dual_right},
        }
      end
    else
      -- Fallback: equal columns
      for i, cs in ipairs(tbl.colspecs) do
        new_colspecs[i] = {cs[1], 1.0 / ncols}
      end
    end

  elseif ncols == 3 and is_centered_title_table(tbl) then
    -- Joint letterhead or MOA title: empty | centered content | empty
    -- Give center column 90% so text doesn't wrap
    new_colspecs = {
      {tbl.colspecs[1][1], 0.05},
      {pandoc.AlignCenter,  0.90},
      {tbl.colspecs[3][1], 0.05},
    }

  elseif ncols == 3 then
    -- MOA dual SSIC or other 3-col layouts — equal distribution
    for i, cs in ipairs(tbl.colspecs) do
      new_colspecs[i] = {cs[1], 1.0 / ncols}
    end

  else
    -- Any other column count: equal distribution
    for i, cs in ipairs(tbl.colspecs) do
      new_colspecs[i] = {cs[1], 1.0 / ncols}
    end
  end

  tbl.colspecs = new_colspecs
  return tbl
end

-- ============================================================
-- Pass 3: Convert LaTeX spacing commands to DOCX spacing
-- ============================================================
-- With +raw_tex, pandoc preserves \bigskip, \medskip, \vspace etc.
-- as RawBlock elements. We convert these to OpenXML paragraphs with
-- proper w:spacing so they produce correct vertical space in DOCX.
--
-- Spacing values (LaTeX → twips, at 12pt):
--   \bigskip    = 1 baselineskip = fontSizePt × 20 twips
--   \medskip    = 0.5 baselineskip
--   \smallskip  = 0.25 baselineskip
--   \vspace{N\baselineskip} = N × fontSizePt × 20 twips

-- Build an OpenXML empty paragraph with specific spacing
local function spacing_para(twips)
  -- Use w:before for the space, and w:line="20" w:lineRule="exact"
  -- to make the paragraph itself nearly zero height.
  -- This ensures only w:before contributes visible spacing.
  local xml = '<w:p><w:pPr>'
    .. '<w:spacing w:before="' .. tostring(twips) .. '" w:after="0" w:line="20" w:lineRule="exact"/>'
    .. '</w:pPr></w:p>'
  return pandoc.RawBlock("openxml", xml)
end

local function handle_raw_block(el)
  if el.format ~= "latex" then return nil end

  local text = el.text

  -- 1 baselineskip in twips at current font size
  local blskip = fontSizePt * 20

  -- \bigskip → 1 baselineskip
  if text:match("^\\bigskip%s*$") then
    return spacing_para(blskip)
  end

  -- \medskip → 0.5 baselineskip
  if text:match("^\\medskip%s*$") then
    return spacing_para(math.floor(blskip / 2))
  end

  -- \smallskip → 0.25 baselineskip
  if text:match("^\\smallskip%s*$") then
    return spacing_para(math.floor(blskip / 4))
  end

  -- \vspace{N\baselineskip} → N × baselineskip
  local n = text:match("^\\vspace%{(%d+)\\baselineskip%}%s*$")
  if n then
    local twips = tonumber(n) * blskip
    return spacing_para(twips)
  end

  -- \vspace{Npt} → N × 20 twips
  local pts = text:match("^\\vspace%{(%d+)pt%}%s*$")
  if pts then
    local twips = tonumber(pts) * 20
    return spacing_para(twips)
  end

  -- \noindent — remove (not needed in DOCX, parindent is already 0)
  if text:match("^\\noindent%s*$") then
    return pandoc.List({})
  end

  -- \rule{Nin}{Xpt} → fixed-width horizontal rule as block (e.g. MOA overscoring)
  local block_rule_width = text:match("^\\rule%{([%d%.]+)in%}%{[%d%.]+pt%}%s*$")
  if block_rule_width then
    local inches = tonumber(block_rule_width)
    if inches and inches > 0 then
      -- Convert to twips (1in = 1440 twips), render as paragraph bottom border
      local twips = math.floor(inches * 1440)
      local xml = '<w:p><w:pPr>'
        .. '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>'
        .. '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
        .. '<w:ind w:right="' .. tostring(9360 - twips) .. '"/>'
        .. '</w:pPr></w:p>'
      return pandoc.RawBlock("openxml", xml)
    end
    return pandoc.List({})
  end

  -- \rule{\textwidth}{0.5pt} → horizontal rule (OpenXML paragraph border)
  if text:match("^\\rule%{\\textwidth%}%{[%d%.]+pt%}%s*$") then
    local xml = '<w:p><w:pPr>'
      .. '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>'
      .. '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
      .. '</w:pPr></w:p>'
    return pandoc.RawBlock("openxml", xml)
  end

  -- \setcounter{page}{N} → pass through as raw OOXML field code
  -- (Page numbering is handled by Word's section properties, not inline;
  -- we just drop this as DOCX page numbering is set in sectPr)
  if text:match("^\\setcounter%{page%}%{%d+%}%s*$") then
    return pandoc.List({})
  end

  -- Other raw LaTeX: drop
  return pandoc.List({})
end

-- ============================================================
-- Pass 4: Convert LaTeX inline commands to DOCX text
-- ============================================================
-- With +raw_tex, inline commands like \mbox{1.} become RawInline elements.
-- We extract the text content and return it as a plain Str inline.

local function handle_raw_inline(el)
  if el.format ~= "latex" then return nil end

  local text = el.text

  -- \mbox{content} → just the content as plain text
  local mbox_content = text:match("^\\mbox%{(.-)%}$")
  if mbox_content then
    return pandoc.Str(mbox_content)
  end

  -- \hbox{content} → just the content as plain text
  local hbox_content = text:match("^\\hbox%{(.-)%}$")
  if hbox_content then
    return pandoc.Str(hbox_content)
  end

  -- \textnormal{content} → just the content as plain text
  local tn_content = text:match("^\\textnormal%{(.-)%}$")
  if tn_content then
    return pandoc.Str(tn_content)
  end

  -- \enspace → thin space
  if text:match("^\\enspace%s*$") then
    return pandoc.Space()
  end

  -- \hspace{Xin} → OpenXML first-line indent via custom Para wrapper
  -- Pandoc doesn't support true inline indentation in DOCX, so we inject
  -- an OpenXML w:ind element. We return the indent as a special marker
  -- that gets applied to the containing paragraph via a post-pass.
  -- Fallback: non-breaking spaces for contexts where OpenXML isn't available.
  local hin = text:match("^\\dondocsindent%{([%d%.]+)in%}$")
  if hin then
    local inches = tonumber(hin)
    if inches and inches > 0 then
      -- Emit non-breaking spaces as a SINGLE Str so pandoc writes them into
      -- one <w:t> element. Step 6a in pandoc-converter.ts matches leading
      -- nbsp sequences in a single <w:t> to convert them to w:ind w:left.
      -- Multiple separate Str("\u{00A0}") would create separate <w:r> runs
      -- that the regex can't match, causing indentation to silently fail.
      local count = math.floor(inches * 6 + 0.5) -- ~6 nbsp per inch
      local nbspStr = string.rep("\u{00A0}", count)
      return pandoc.Str(nbspStr)
    end
    return pandoc.List({})
  end

  -- \dondocsfirstindent{Xin} → first-line indent (w:ind w:firstLine)
  -- Same as \dondocsindent but uses em-space (U+2003) as marker so
  -- pandoc-converter.ts step 6a can distinguish and emit w:firstLine.
  local fin = text:match("^\\dondocsfirstindent%{([%d%.]+)in%}$")
  if fin then
    local inches = tonumber(fin)
    if inches and inches > 0 then
      local count = math.floor(inches * 6 + 0.5)
      local emStr = string.rep("\u{2003}", count)
      return pandoc.Str(emStr)
    end
    return pandoc.List({})
  end

  -- \rule{Xin}{Xpt} → inline horizontal line (approximated with underscores)
  -- Used for MOA/MOU overscored signatures. The block-level \rule{\textwidth}
  -- variant is handled in handle_raw_block; this handles fixed-width rules inline.
  local rule_width = text:match("^\\rule%{([%d%.]+)in%}%{[%d%.]+pt%}$")
  if rule_width then
    local inches = tonumber(rule_width)
    if inches and inches > 0 then
      -- Approximate with underscores: ~8 underscores per inch at 12pt
      local count = math.floor(inches * 8 + 0.5)
      local chars = {}
      for _ = 1, count do
        chars[#chars + 1] = pandoc.Str("_")
      end
      return chars
    end
    return pandoc.List({})
  end

  -- \noindent inline → remove
  if text:match("^\\noindent%s*$") then
    return pandoc.List({})
  end

  -- \enclref{N} → "Enclosure (N)" as plain text
  local encl_num = text:match("^\\enclref%{(%d+)%}$")
  if encl_num then
    return pandoc.Str("Enclosure (" .. encl_num .. ")")
  end

  -- \reflink{a} → "Reference (a)" as plain text
  local ref_letter = text:match("^\\reflink%{([a-zA-Z])%}$")
  if ref_letter then
    return pandoc.Str("Reference (" .. ref_letter .. ")")
  end

  -- \fcolorbox{...}{...}{content} → extract inner text for batch placeholders
  -- Pattern: \fcolorbox{orange}{yellow!30}{\textsf{\small NAME}}
  local fbox_content = text:match("^\\fcolorbox%{[^}]*%}%{[^}]*%}%{(.-)%}$")
  if fbox_content then
    -- Strip inner formatting: \textsf{\small NAME} → NAME
    local inner = fbox_content:match("\\textsf%{\\small (.-)%}") or fbox_content
    -- Un-escape underscores for display
    inner = inner:gsub("\\_", "_")
    return pandoc.Strong({pandoc.Str("{{" .. inner .. "}}")})
  end

  -- Other raw LaTeX inline: drop
  return pandoc.List({})
end

-- Four-pass execution: Meta → Table → RawBlock → RawInline
return {
  { Meta = read_meta },
  { Table = apply_table },
  { RawBlock = handle_raw_block },
  { RawInline = handle_raw_inline },
}
