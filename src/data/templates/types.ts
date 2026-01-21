export interface TemplateParagraph {
  text: string;
  level: number;
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
