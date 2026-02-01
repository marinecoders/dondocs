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
import { MOASection } from '@/components/editor/MOASection';
import { JointLetterSection } from '@/components/editor/JointLetterSection';
import { JointMemoSection } from '@/components/editor/JointMemoSection';
import { Form6105Section } from '@/components/editor/Form6105Section';
import { Form11811Section } from '@/components/editor/Form11811Section';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { DOC_TYPE_CONFIG } from '@/types/document';

export function FormPanel() {
  const { docType, documentCategory, formType } = useDocumentStore();
  const { previewVisible } = useUIStore();
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;

  const isFormsMode = documentCategory === 'forms';
  const isMOAMode = config.uiMode === 'moa';
  const isJointLetterMode = config.uiMode === 'joint';
  const isJointMemoMode = config.uiMode === 'joint_memo';

  return (
    <div className="flex flex-col h-full border-r border-border bg-card overflow-hidden w-full">
      <ProfileBar />

      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className={`p-3 sm:p-density-4 space-y-density-6 overflow-x-hidden ${!previewVisible ? 'max-w-4xl mx-auto' : 'max-w-full'}`}>
          <DocumentTypeSelector />

          {isFormsMode ? (
            <>
              {/* Forms UI */}
              {formType === 'navmc_10274' && <Form6105Section />}
              {formType === 'navmc_118_11' && <Form11811Section />}
            </>
          ) : isMOAMode ? (
            <>
              {/* MOA/MOU specific UI - handles dual commands and signatures */}
              <MOASection />

              <ClassificationSection />

              <ParagraphsEditor />

              <ReferencesManager />

              <EnclosuresManager />

              <CopyToManager />
            </>
          ) : isJointLetterMode ? (
            <>
              {/* Joint Letter UI - dual letterheads and signatures */}
              <JointLetterSection />

              <ClassificationSection />

              <ParagraphsEditor />

              <ReferencesManager />

              <EnclosuresManager />

              <CopyToManager />
            </>
          ) : isJointMemoMode ? (
            <>
              {/* Joint Memorandum UI - dual signatures */}
              {config.letterhead && <LetterheadSection />}

              <JointMemoSection />

              <ClassificationSection />

              <ParagraphsEditor />

              <ReferencesManager />

              <EnclosuresManager />

              <CopyToManager />
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
            </>
          )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
