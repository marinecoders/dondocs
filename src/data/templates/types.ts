export interface TemplateParagraph {
  text: string;
  level: number;
  /** Underlined paragraph heading (Ch 7 ¶13d). Technical publications name
   *  their paragraphs from a fixed set, so the title is part of the template
   *  rather than something the author types. */
  header?: string;
  /** Names the fixed table this paragraph carries, if any. */
  tableKey?: string;
}

export interface TemplateReference {
  letter: string;
  title: string;
  url?: string;
}

export interface LetterTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  docType: string;
  subject: string;
  paragraphs: TemplateParagraph[];
  references?: TemplateReference[];
  ssic?: string;
}
