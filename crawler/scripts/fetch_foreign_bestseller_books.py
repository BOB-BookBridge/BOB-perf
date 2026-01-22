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

TARGET_ADD = 77

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
  90832: 28, 90829: 12, 91457: 21, 90844: 38, 90854: 44, 90839: 19,
}

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

  if not has_korean(title):
    return False

  for keyword in EXCLUDED_TITLE_KEYWORDS:
    if keyword in title:
      return False

  isbn = item.get("isbn13", item.get("isbn", ""))
  if isbn and not (isbn.startswith("978") or isbn.startswith("979")):
    return False

  return True


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


def fetch_foreign_bestseller(page):
  print(f"  ▶ API 요청: 외국도서 베스트셀러 (page={page})")

  params = {
    "ttbkey": TTB_KEY,
    "QueryType": "Bestseller",
    "MaxResults": 50,
    "start": page,
    "SearchTarget": "Foreign",
    "output": "js",
    "Version": "20131101",
  }

  try:
    response = requests.get(BASE_URL, params=params, timeout=30)
    response.raise_for_status()

    text = response.text
    if text.startswith("var "):
      text = text.split("=", 1)[1].strip().rstrip(";")

    data = json.loads(text)
    items = data.get("item", [])
    print(f"  응답 수신: {len(items)}개")
    return items

  except Exception as e:
    print(f"  API 오류: {e}")
    return []


def main():
  json_path = "../BOB-perf/resources/data/bestseller_books_data.json"

  print("=" * 60)
  print(f" 외국도서 베스트셀러 {TARGET_ADD}개 추가")
  print("=" * 60)

  with open(json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

  existing_books = data["books"]
  seen_isbns = set(book["isbn"] for book in existing_books)

  print(f"\n기존 도서 수: {len(existing_books)}개")
  print(f"기존 ISBN 수: {len(seen_isbns)}개")

  # 외국도서 베스트셀러 수집
  new_books = []
  page = 1

  while len(new_books) < TARGET_ADD and page <= 10:
    items = fetch_foreign_bestseller(page)

    if not items:
      break

    for item in items:
      isbn = item.get("isbn13", item.get("isbn", ""))

      if not isbn or isbn in seen_isbns:
        continue

      if not is_valid_book(item):
        continue

      seen_isbns.add(isbn)
      book = transform_book_data(item)
      new_books.append(book)
      print(f"    + {book['title'][:40]}")

      if len(new_books) >= TARGET_ADD:
        break

    page += 1
    time.sleep(0.5)

  print(f"\n새로 추가된 도서: {len(new_books)}개")

  # 데이터 병합 및 저장
  existing_books.extend(new_books)
  data["books"] = existing_books
  data["metadata"]["totalCount"] = len(existing_books)
  data["metadata"]["createdAt"] = datetime.now().isoformat()
  data["metadata"]["description"] += f" + 외국도서 베스트셀러 {len(new_books)}개 추가"

  with open(json_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

  print(f"\n저장 완료: {json_path}")
  print(f"총 도서 수: {len(existing_books)}개")


if __name__ == "__main__":
  main()
