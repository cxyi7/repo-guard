export const KNIP_METADATA_MARKER = '@@REPO_GUARD_KNIP_METADATA@@';

export default function reportKnipMetadata({ configurationHints }) {
  const configurationHintCount = Array.isArray(configurationHints)
    ? configurationHints.length
    : 0;
  process.stdout.write(
    `\n${KNIP_METADATA_MARKER}${JSON.stringify({ configurationHintCount })}\n`,
  );
}
