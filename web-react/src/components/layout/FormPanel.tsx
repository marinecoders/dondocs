import { ScrollArea } from '@/components/ui/scroll-area';
import { DocumentTypeSelector } from '@/components/editor/DocumentTypeSelector';
import { LetterheadSection } from '@/components/editor/LetterheadSection';
import { AddressingSection } from '@/components/editor/AddressingSection';
import { ClassificationSection } from '@/components/editor/ClassificationSection';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { ReferencesManager } from '@/components/editor/ReferencesManager';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { ParagraphsEditor } from '@/components/editor/ParagraphsEditor';
import { CopyToManager } from '@/components/editor/CopyToManager';
import { ProfileBar } from '@/components/editor/ProfileBar';
import { DocumentStats } from '@/components/editor/DocumentStats';
import { MOASection } from '@/components/editor/MOASection';
import { useDocumentStore } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG } from '@/types/document';

export function FormPanel() {
  const { docType } = useDocumentStore();
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;

  const isMOAMode = config.uiMode === 'moa';

  return (
    <div className="flex flex-col h-full border-r border-border bg-card overflow-hidden">
      <ProfileBar />

      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-6">
          <DocumentTypeSelector />

          {isMOAMode ? (
            <>
              {/* MOA/MOU specific UI - handles dual commands and signatures */}
              <MOASection />

              <ClassificationSection />

              <ParagraphsEditor />

              <ReferencesManager />

              <EnclosuresManager />

              <CopyToManager />

              <DocumentStats />
            </>
          ) : (
            <>
              {/* Standard document UI */}
              {config.letterhead && <LetterheadSection />}

              <AddressingSection config={config} />

              <ClassificationSection />

              <ParagraphsEditor />

              <ReferencesManager />

              <EnclosuresManager />

              <CopyToManager />

              <SignatureSection config={config} />

              <DocumentStats />
            </>
          )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
