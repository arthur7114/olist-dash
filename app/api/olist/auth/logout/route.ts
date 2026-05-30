import { NextResponse } from "next/server"
import {
  OLIST_ACCESS_COOKIE,
  OLIST_REFRESH_COOKIE,
  OLIST_STATE_COOKIE,
} from "@/lib/olist-v3"

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url))
  response.cookies.delete(OLIST_ACCESS_COOKIE)
  response.cookies.delete(OLIST_REFRESH_COOKIE)
  response.cookies.delete(OLIST_STATE_COOKIE)
  return response
}
