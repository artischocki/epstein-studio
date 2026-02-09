from django.shortcuts import render


MOBILE_KEYWORDS = ("mobile", "android", "iphone", "ipad", "ipod")


class MobileBlockMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ""
        if path.startswith("/static/") or path.startswith("/media/"):
            return self.get_response(request)
        ua = (request.META.get("HTTP_USER_AGENT") or "").lower()
        if ua and any(keyword in ua for keyword in MOBILE_KEYWORDS):
            return render(request, "epstein_ui/mobile_block.html", status=403)
        return self.get_response(request)
