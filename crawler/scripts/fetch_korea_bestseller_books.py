import requests
import json
import time
import os
import re
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

TTB_KEY = os.getenv("TTB_KEY")
BASE_URL = "http://www.aladin.co.kr/ttb/api/ItemList.aspx"

TOTAL_TARGET = 3000

SOURCE_TO_PROJECT_CATEGORY = {
  170: 12, 2172: 13, 178: 14, 180: 15, 2176: 16,

  987: 19, 351: 21, 2105: 20, 2030: 18, 2029: 17,

  2551: 24, 4150: 24, 6246: 25, 5765: 22,

  1: 29, 50920: 29, 50921: 28, 50940: 26, 55889: 27,

  1137: 31, 1196: 30, 13789: 32, 4395: 33,

  517: 34, 1484: 35, 1482: 36, 1485: 37,

  656: 42, 2913: 42, 51374: 39, 798: 40, 2922: 38, 2923: 41,

  336: 44, 2946: 43, 70219: 45, 2948: 46, 2947: 47,

  1383: 48, 1230: 49, 53476: 50, 55890: 52,

  1108: 53, 8257: 54, 50246: 55, 2892: 56, 76000: 57,
}

EXCLUDED_CATEGORY_KEYWORDS = [
  "굿즈", "피규어", "음반", "DVD", "블루레이", "LP", "캘린더", "다이어리",
  "문구", "완구", "게임", "퍼즐", "카드", "포스터", "액세서리"
]

EXCLUDED_TITLE_KEYWORDS = [
  "특전판)", "더블특전", "트리플특전", "초판 한정", "얼리버드", "선착순",
  "포토카드", "일러스트 카드", "카드 세트", "카드+", "+카드",
  "브로마이드", "아크릴", "키링", "배지",
  "티켓+", "+티켓", "스탠드+", "+스탠드", "피규어", "굿즈키트", "+굿즈",
  "박스 세트", "박스세트", "선물세트", "기프트세트",
  "캘린더 포함", "다이어리 포함", "플래너 포함",
  "홀로그램 카드", "양면 카드", "양면 포토", "양면 일러스트",
  "PP 카드", "PP카드", "랩핑본", "PET 카드",
]


def has_korean(text):
  if not text:
    return False
  return bool(re.search(r'[가-힣]', text))


def is_valid_book(item):
  title = item.get("title", "")
  category_name = item.get("categoryName", "")

  if not has_korean(title):
    return False

  for keyword in EXCLUDED_CATEGORY_KEYWORDS:
    if keyword in category_name:
      return False

  for keyword in EXCLUDED_TITLE_KEYWORDS:
    if keyword in title:
      return False

  isbn = item.get("isbn13", item.get("isbn", ""))
  if isbn and not (isbn.startswith("978") or isbn.startswith("979")):
    return False

  return True


def fetch_weekly_bestseller(year, month, week, page):
  print(f"      ▶ API 요청: {year}년 {month}월 {week}주차 (page={page})")

  params = {
    "ttbkey": TTB_KEY,
    "QueryType": "Bestseller",
    "MaxResults": 50,
    "start": page,
    "SearchTarget": "Book",
    "output": "js",
    "Version": "20131101",
    "Year": year,
    "Month": month,
    "Week": week,
  }

  try:
    response = requests.get(BASE_URL, params=params, timeout=30)
    response.raise_for_status()

    text = response.text
    if text.startswith("var "):
      text = text.split("=", 1)[1].strip().rstrip(";")

    data = json.loads(text)

    if "errorCode" in data:
      print(f"      API 에러: {data.get('errorMessage', 'Unknown error')}")
      return None

    items = data.get("item", [])
    print(f"      응답 수신: {len(items)}개")
    return items

  except Exception as e:
    print(f"      API 오류: {e}")
    return None


def get_project_category_id(source_category_id):
  return SOURCE_TO_PROJECT_CATEGORY.get(int(source_category_id), 58) if source_category_id else 58


def transform_book_data(item):
  pub_date = item.get("pubDate") or "2024-01-01"
  source_cat_id = item.get("categoryId")

  return {
    "isbn": item.get("isbn13", item.get("isbn", "")),
    "title": item.get("title", "").replace(" - ", " ").strip()[:200],
    "author": item.get("author", "").split(" (")[0].strip()[:100],
    "description": (item.get("description") or "")[:500],
    "priceStandard": item.get("priceStandard") or 15000,
    "cover": item.get("cover", "").replace("coversum", "cover500"),
    "pubDate": pub_date,
    "categoryId": get_project_category_id(source_cat_id),
    "sourceCategoryId": source_cat_id,
  }


def generate_months(start_year, start_month, count=100):
  """월별 목록을 역순으로 생성합니다. (각 월의 1주차만)"""
  months = []
  year, month = start_year, start_month

  for _ in range(count):
    months.append((year, month, 1))

    month -= 1
    if month < 1:
      year -= 1
      month = 12

  return months


def fetch_all_books():
  all_books = []
  seen_isbns = set()

  print("=" * 60)
  print(f" 국내도서 베스트셀러 수집 시작 (목표: {TOTAL_TARGET}개)")
  print("    - 2025년 12월 1주차부터 월별 역순 수집")
  print("    - 각 월의 1주차, 1페이지(50개)만 수집")
  print("    - 한글 제목 도서만 필터링")
  print("=" * 60)

  # 2025년 12월부터 시작, 월별 1주차만 (약 100개월 = 8년 이상)
  months = generate_months(2025, 12, count=100)

  for year, month, week in months:
    if len(all_books) >= TOTAL_TARGET:
      break

    print(f"\n▶ [{year}년 {month}월 {week}주차 베스트셀러]")

    # 1페이지만 요청 (50개)
    items = fetch_weekly_bestseller(year, month, week, page=1)

    if items is None:
      # API 에러 (해당 월 데이터 없음)
      print(f"  {year}년 {month}월 데이터 없음, 스킵")
      continue

    if not items:
      print(f"  {year}년 {month}월 빈 응답, 스킵")
      continue

    month_collected = 0
    filtered_count = 0

    for item in items:
      isbn = item.get("isbn13", item.get("isbn", ""))

      if not isbn:
        continue

      if isbn in seen_isbns:
        continue

      if not is_valid_book(item):
        filtered_count += 1
        continue

      seen_isbns.add(isbn)
      book = transform_book_data(item)
      all_books.append(book)
      month_collected += 1

      if len(all_books) >= TOTAL_TARGET:
        break

    if filtered_count > 0:
      print(f"      (필터링 제외: {filtered_count}개)")

    print(f"  {year}년 {month}월: 신규 {month_collected}개 | 총 {len(all_books)}/{TOTAL_TARGET}")
    time.sleep(0.5)

  print("\n" + "=" * 60)
  print(f"전체 수집 완료: {len(all_books)}개 / 목표 {TOTAL_TARGET}개")
  print("=" * 60)

  return all_books


def save_to_json(books, filename):
  print(f"\n파일 저장 시작: {filename}")

  output = {
    "metadata": {
      "totalCount": len(books),
      "createdAt": datetime.now().isoformat(),
      "source": "Aladin API - 국내도서 베스트셀러 (한글 도서만)",
      "description": "2025년 12월부터 월별 1주차 역순 수집 (각 월 50개)"
    },
    "books": books,
  }

  with open(filename, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

  print("파일 저장 완료")


if __name__ == "__main__":
  books = fetch_all_books()

  if books:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    docs_dir = os.path.join(script_dir, "resources/data")

    os.makedirs(docs_dir, exist_ok=True)

    output_path = os.path.join(docs_dir, "bestseller_books_data.json")
    save_to_json(books, output_path)

    print("\n📌 샘플 데이터 (처음 5개)")
    for book in books[:5]:
      print(json.dumps(book, ensure_ascii=False, indent=2))

    print(f"\n수집 통계")
    print(f"  - 총 수집: {len(books)}개")
    print(f"  - 고유 ISBN: {len(set(b['isbn'] for b in books))}개")
  else:
    print("수집된 데이터가 없습니다.")
