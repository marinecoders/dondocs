# Resumable package assembly

Resumable PDF assembly saves generated member PDFs while assembling one exact saved package revision. Open **Resumable PDF assembly**, prepare its review, inspect the captured documents and findings, then start the reviewed assembly. The progress count advances only after a member has actually been copied or placed into the result.

**Pause assembly** cancels the active operation and retains committed checkpoints. After a reload, use **Review saved job**, inspect the captured revision again and resume. Checkpoints never carry a previous acknowledgement. A resumed job can add its output to an older saved revision while preserving the package's newer current revision and work.

The ordinary assembly path remains available. Resumable jobs are local browser work records, excluded from portable packages and workspace backups. Completed PDFs belong to the package revision and follow its normal backup and transfer behavior. Removing a saved job removes its checkpoints, while retaining any completed package PDF.

## Input and ownership checks

A job binds the complete saved source revision and package name, deployment policy, application build, runtime and template revision. Changed inputs require a new reviewed job. Native PDF checkpoints also bind member identity, actual starting page and the exact rendering layout. An endorsement's same-page trial and new-page fallback therefore use distinct checkpoints.

Original PDFs always use their preserved source bytes. Generated-PDF checkpoints never replace an original. Each saved checkpoint is checked for byte length, SHA-256 and page count before reuse. A missing or corrupt checkpoint stops the job; remove it and prepare a new reviewed assembly.

A live lease prevents two tabs from running the same job. The active tab renews it during rendering and asynchronous final file checks. Publication freezes the current lease immediately before its write transaction. Reloading or closing the tab can leave a lease active for up to 45 seconds; refresh the saved job list after it expires. Taking over requires a new private preparation, new acknowledgement and new ownership token. An expired owner cannot renew its old token.

Final publication checks the current package metadata, actual attachment contents and live job ownership together in one database transaction. It installs the staged output, completes the job and removes its checkpoint bytes atomically. A package change, policy change, lost lease, cancelled operation or failed write leaves the saved package unchanged.

## Limits and verification

Up to 20 job records are retained. Captured inputs and generated checkpoint bytes each have a 75 MB limit per job. Incomplete jobs share a 250 MB checkpoint limit. Individual generated PDFs are limited to 25 MB and 500 pages; assembled output including front matter is limited to 500 pages and the normal package-file limit. These bounds limit retained bytes and page counts; PDF decoding still uses the browser's available memory. Use a smaller selected delivery if a package exceeds these limits.

The focused verification suite exercises actual PDF generation and parsing, configured forms with retained templates, original preservation, per-member progress, cancellation, reload/resume, preservation of newer package revisions, policy/source changes, stale ownership at publication, checkpoint corruption and quota rollback:

```sh
npx vitest run tests/unit/packageJobs.test.ts tests/component/PackageJobsPanel.test.tsx tests/unit/actionPackages.test.ts tests/unit/packageFrontMatter.test.ts
```

The renderer ports in correspondence tests return real synthetic PDFs. A separate configured-form test uses the actual local form renderer. Production browser checks should also cover the PDF engine, reloads and the Light, Dark and Classic layouts at desktop and mobile widths.
