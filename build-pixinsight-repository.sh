#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")" && pwd)"
scripts_root="$repo_dir"
output_dir="$repo_dir/pixinsight-repository"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/pixinsight-repository.XXXXXX")"

cleanup()
{
   rm -rf "$stage_dir"
}
trap cleanup EXIT

mkdir -p "$stage_dir/src/scripts" "$output_dir"

while IFS= read -r -d '' source_file; do
   relative_path="${source_file#"$scripts_root"/}"
   destination="$stage_dir/src/scripts/$relative_path"
   mkdir -p "$(dirname "$destination")"
   cp "$source_file" "$destination"
done < <(
   find "$scripts_root" -type f -name '*.js' \
      -not -path "$output_dir/*" \
      -not -path "$repo_dir/.git/*" \
      -print0
)

rm -rf "$output_dir/src"
cp -a "$stage_dir/src" "$output_dir/"

release_date="$(date -u +%Y%m%d)"
release_stamp="$(date -u +%Y%m%d-%H%M%S)"
archive_name="pi_scripts-$release_stamp.zip"
archive_path="$output_dir/$archive_name"
find "$output_dir" -maxdepth 1 -type f -name 'pi_scripts-*.zip' -delete
( cd "$stage_dir" && zip -qr "$archive_path" src )

sha1="$(sha1sum "$archive_path" | awk '{print $1}')"

printf '%s\n' \
   '<?xml version="1.0" encoding="UTF-8"?>' \
   '<xri version="1.0">' \
   '   <description>' \
   '      <p>Personal PixInsight scripts.</p>' \
   '   </description>' \
   '   <platform os="all" arch="noarch" version="1.8.9:1.9.99">' \
   "      <package fileName=\"$archive_name\" sha1=\"$sha1\" type=\"script\" releaseDate=\"$release_date\">" \
   "         <title>Personal PixInsight scripts $release_date</title>" \
   '         <description>All JavaScript files under the pi_scripts directory.</description>' \
   '      </package>' \
   '   </platform>' \
   '</xri>' > "$output_dir/updates.xri"

echo "Built: $archive_path"
echo "Repository metadata: $output_dir/updates.xri"
