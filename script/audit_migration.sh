#!/usr/bin/env bash
#
# Table by table, what did the migration change, and is any of it a loss.
#
#   script/audit_migration.sh            every shop
#   script/audit_migration.sh ca         one shop
#
# ── why this exists ──────────────────────────────────────────────────────────
#
# Everything checked so far was checked because something looked wrong: products
# vanished, images 404ed, a storefront was empty. That finds what you go looking
# for. This asks the opposite question — what changed that nobody has looked at
# — by comparing the untouched dump against the migrated copy for every table in
# both, and reporting anything that lost rows.
#
# A row count is a blunt instrument and deliberately so: it needs no knowledge of
# what a table means, so it cannot skip a table nobody thought about.
#
# ── expected differences ─────────────────────────────────────────────────────
#
# The 5.6 upgrade legitimately removes some tables and adds others, so a bare
# diff is mostly noise. EXPECTED_GONE lists the ones whose disappearance is the
# upgrade working as designed; everything else that loses rows is printed as a
# question. The list is short on purpose — a long allow-list is how a real loss
# gets waved through.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

# Read from .estate, never written out here. Two reasons, and the second is the
# one that bit: the list would drift the moment a shop is added, and this
# repository is public, so a hardcoded list publishes which shops the client runs.
SHOPS="${1:-$(awk -F"|" '$1 !~ /^#/ && NF > 3 { printf "%s ", $1 }' .estate 2>/dev/null)}"
[ -n "${SHOPS// /}" ] || { echo "no shops: .estate is missing or empty"; exit 2; }

# Tables 5.6 drops, with what replaces them. Anything here is reported as a note
# rather than a problem, and the replacement is counted so the carry can be seen.
# A case, not an associative array: macOS ships bash 3.2, where `declare -A`
# does not exist and the lookup fails with "unbound variable" under set -u.
expected_gone() {
  case "$1" in
    spree_product_properties) echo 'thay bằng spree_metafields' ;;
    spree_properties)         echo 'thay bằng spree_metafield_definitions' ;;
    *)                        echo '' ;;
  esac
}

# Tables that legitimately lose rows, with the reason. Each of these was checked
# by hand the first time it appeared, and the reason is recorded so the next run
# does not have to check it again — and so anything NOT on this list still shows
# up as a question.
expected_fewer() {
  case "$1" in
    active_storage_variant_records)
      echo 'ảnh thu nhỏ dẫn xuất, đã xoá có chủ ý, Rails sinh lại khi cần' ;;
    active_storage_attachments|active_storage_blobs)
      echo 'phần chênh là bản variant đi kèm, ảnh gốc được đếm riêng' ;;
    spree_states)
      echo 'dọn trùng: Ý 220 dòng chỉ có 110 tên. AU/CA/NZ/US không đổi' ;;
    friendly_id_slugs)
      echo 'slug lịch sử của danh mục. Mọi taxon hiện hành vẫn còn slug' ;;
    *) echo '' ;;
  esac
}

# `< /dev/null` is not optional. docker compose exec reads stdin even with -T,
# so calling this inside a `while read ... <<< "$list"` loop swallows the rest
# of the list and the loop ends after one pass. This is the third time that has
# happened in this project: twice with ssh, once here, and each time the symptom
# was a check reporting success having examined one item, or none.
psql_local() { docker compose exec -T postgres psql -U postgres -d "$1" -At -F'|' -c "$2" < /dev/null 2>/dev/null | tr -d '\r'; }

counts_for() {
  # table|rows for every non-empty public table, one per line.
  psql_local "$1" "
    SELECT c.relname, c.reltuples::bigint
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname"
}

# reltuples is an estimate refreshed by ANALYZE, and an estimate is not good
# enough to tell a client nothing was lost. Exact counts, one query per table.
exact() { psql_local "$1" "SELECT count(*) FROM \"$2\""; }

# Reachability first, and loudly. Every query below sends stderr to /dev/null so
# a missing table is quiet, which means a DEAD DATABASE looks exactly like an
# absent one: the first version of this script printed "no source to compare,
# skipping" for every shop and then "ok — nothing lost", with Docker not running.
# A checker that cannot reach its subject must say so, not pass.
if ! docker compose exec -T postgres psql -U postgres -At -c 'SELECT 1' < /dev/null >/dev/null 2>&1; then
  echo '  không kết nối được postgres ở máy này. Docker đang chạy chứ?' >&2
  echo '  (các shop trên server không bị ảnh hưởng, đây chỉ là bản đối chiếu ở máy)' >&2
  exit 2
fi

total_issues=0
audited=0

for shop in $SHOPS; do
  src="${shop}_pristine"
  dst="${shop}_migrate"
  # nz's untouched copy was named differently by the rehearsal that made it.
  if [ -z "$(psql_local postgres "SELECT 1 FROM pg_database WHERE datname='$src'")" ]; then
    src="${shop}_rehearsal"
  fi
  if [ -z "$(psql_local postgres "SELECT 1 FROM pg_database WHERE datname='$src'")" ]; then
    printf '\n  %s: không có bản gốc để đối chiếu, bỏ qua\n' "$shop"
    continue
  fi

  audited=$((audited + 1))
  printf '\n  === %s (%s -> %s)\n' "$shop" "$src" "$dst"

  src_tables=$(psql_local "$src" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  lost=0; gone=0; checked=0

  while IFS= read -r t; do
    [ -n "$t" ] || continue
    s=$(exact "$src" "$t")
    [ "${s:-0}" -gt 0 ] 2>/dev/null || continue    # empty in the source proves nothing
    checked=$((checked + 1))

    exists=$(psql_local "$dst" "SELECT to_regclass('public.$t') IS NOT NULL")
    if [ "$exists" != "t" ]; then
      note=$(expected_gone "$t")
      if [ -n "$note" ]; then
        printf '    note  %-38s %6s dòng -> bảng bị bỏ, %s\n' "$t" "$s" "$note"
      else
        printf '    MẤT   %-38s %6s dòng -> BẢNG KHÔNG CÒN\n' "$t" "$s"
        gone=$((gone + 1))
      fi
      continue
    fi

    d=$(exact "$dst" "$t")
    if [ "${d:-0}" -lt "${s:-0}" ] 2>/dev/null; then
      why=$(expected_fewer "$t")
      if [ -n "$why" ]; then
        printf '    note  %-34s %6s -> %-6s %s\n' "$t" "$s" "$d" "$why"
      else
        printf '    MẤT   %-34s %6s -> %-6s (thiếu %s)\n' "$t" "$s" "$d" "$((s - d))"
        lost=$((lost + 1))
      fi
    fi
  done <<< "$src_tables"

  if [ "$lost" -eq 0 ] && [ "$gone" -eq 0 ]; then
    printf '    ok — %s bảng có dữ liệu, không bảng nào mất dòng\n' "$checked"
  else
    printf '    %s bảng thiếu dòng, %s bảng biến mất ngoài dự kiến\n' "$lost" "$gone"
    total_issues=$((total_issues + lost + gone))
  fi
done

printf '\n'
# Zero shops audited is not success. It is the same green as "everything passed"
# and it is the reason this guard exists.
if [ "$audited" -eq 0 ]; then
  echo '  không shop nào được đối chiếu. Không có kết luận nào để rút ra.' >&2
  exit 2
fi
if [ "$total_issues" -eq 0 ]; then
  echo "  ok — $audited shop đối chiếu, không mất dữ liệu ngoài những bảng 5.6 cố ý bỏ"
  exit 0
fi
echo "  $total_issues chỗ cần giải thích trước khi chuyển đổi"
exit 1
