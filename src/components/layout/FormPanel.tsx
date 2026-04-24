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
import { DistributionManager } from '@/components/editor/DistributionManager';
import { MOASection } from '@/components/editor/MOASection';
import { JointLetterSection } from '@/components/editor/JointLetterSection';
import { JointMemoSection } from '@/components/editor/JointMemoSection';
import { ExecutiveMemoSection } from '@/components/editor/ExecutiveMemoSection';
import { ProfileBar } from '@/components/editor/ProfileBar';
import { Form6105Section } from '@/components/editor/Form6105Section';
import { Form11811Section } from '@/components/editor/Form11811Section';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { DOC_TYPE_CONFIG } from '@/types/document';

export function FormPanel() {
  const { documentCategory, formType, docType } = useDocumentStore();
  const previewVisible = useUIStore((s) => s.previewVisible);
  const isMobile = useUIStore((s) => s.isMobile);
  const config = DOC_TYPE_CONFIG[docType] || DOC_TYPE_CONFIG.naval_letter;

  const isFormsMode = documentCategory === 'forms';

  return (
    <div className={`flex flex-col h-full bg-card overflow-hidden w-full ${!isMobile ? 'border-r border-border' : ''}`}>
      <ProfileBar />

      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className={`p-3 sm:p-density-4 space-y-density-6 overflow-x-hidden ${isMobile ? 'pb-24' : ''} ${!previewVisible ? 'max-w-4xl mx-auto' : 'max-w-full'}`}>
          <DocumentTypeSelector />

          {isFormsMode ? (
            <>
              {/* Forms UI */}
              {formType === 'navmc_10274' && <Form6105Section />}
              {formType === 'navmc_118_11' && <Form11811Section />}
            </>
          ) : config.uiMode === 'moa' ? (
            <>
              {/* MOA / MOU - dual command sections */}
              <MOASection />
              <ClassificationSection />
              <ParagraphsEditor />
              <ReferencesManager />
              <EnclosuresManager />
              <CopyToManager />
              <DistributionManager />
            </>
          ) : config.uiMode === 'joint' ? (
            <>
              {/* Joint Letter - dual letterhead */}
              <JointLetterSection />
              <ClassificationSection />
              <ParagraphsEditor />
              <ReferencesManager />
              <EnclosuresManager />
              <CopyToManager />
              <DistributionManager />
            </>
          ) : config.uiMode === 'joint_memo' ? (
            <>
              {/* Joint Memorandum - dual signatory */}
              <JointMemoSection />
              <ClassificationSection />
              <ParagraphsEditor />
              <ReferencesManager />
              <EnclosuresManager />
              <CopyToManager />
              <DistributionManager />
            </>
          ) : config.uiMode === 'executive' ? (
            <>
              {/* Executive Memos - standard_memorandum, action_memorandum, information_memorandum */}
              <ExecutiveMemoSection />
              <ClassificationSection />
              <ParagraphsEditor />
              <CopyToManager />
              <DistributionManager />
              <SignatureSection config={config} />
            </>
          ) : (
            <>
              {/* Standard / Memo / Business */}
              <LetterheadSection />

              <AddressingSection config={config} />

              <ClassificationSection />

              <ParagraphsEditor />

              <ReferencesManager />

              <EnclosuresManager />

              <CopyToManager />

              <DistributionManager />

              <SignatureSection config={config} />
            </>
          )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
