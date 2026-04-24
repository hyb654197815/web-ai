from langchain.tools import tool
from langgraph.config import get_stream_writer

from agent_context import (
    find_current_route,
    format_route_entry,
    load_routes,
    resolve_route_reference,
    search_routes,
)
from agent_settings import AGENT_MAX_PAGE_DOC_CHARS
from agent_support import truncate
from tools import read_page_doc


def _emit_custom_event(payload: dict[str, str]) -> None:
    try:
        writer = get_stream_writer()
    except Exception:
        return

    try:
        writer(payload)
    except Exception:
        return


def build_agent_tools(*, pathname: str):
    routes = load_routes()

    @tool("search_routes")
    def search_routes_tool(query: str) -> str:
        """按业务描述、中文页面名、路径关键词搜索候选路由。适用于用户目标页面模糊或同名页面较多的场景。"""

        _emit_custom_event(
            {
                "stage": "action",
                "title": "搜索候选路由",
                "summary": "根据用户问题搜索最相关的候选页面。",
            }
        )

        matches = search_routes(query, pathname=pathname)
        if not matches:
            return "未找到明显匹配的路由候选。"

        content = "\n".join(f"- {format_route_entry(route)}" for route in matches)
        _emit_custom_event(
            {
                "stage": "observation",
                "title": "路由搜索结果",
                "summary": f"已返回 {len(matches)} 个候选路由。",
            }
        )
        return content

    @tool("get_page_doc")
    def get_page_doc_tool(route_or_doc: str) -> str:
        """读取某个页面的 webAIDocs/page-xxx.md。优先传精确路由路径、page-xxx.md 文件名，或使用 current/当前页 读取当前页面文档。"""

        route = resolve_route_reference(route_or_doc, pathname=pathname, routes=routes)
        if route is None:
            candidates = search_routes(route_or_doc, pathname=pathname)
            if not candidates:
                return "未能定位到对应页面文档，请改用精确路由路径或 page-xxx.md 文件名。"
            return "未能直接定位到页面文档，可参考这些候选路由后重试：\n" + "\n".join(
                f"- {format_route_entry(item)}" for item in candidates
            )

        if not route.doc_file:
            return f"路由 {route.path} 没有关联的页面文档。"

        _emit_custom_event(
            {
                "stage": "action",
                "title": "读取页面文档",
                "summary": "读取相关页面说明，补充业务上下文。",
            }
        )

        content = read_page_doc(route.doc_file)
        if not content.strip():
            return f"未读取到 {route.doc_file} 的内容。"

        preview = truncate(content, AGENT_MAX_PAGE_DOC_CHARS)
        _emit_custom_event(
            {
                "stage": "observation",
                "title": "页面文档已加载",
                "summary": "已获取相关页面说明，可继续判断问答或跳转结果。",
            }
        )
        return "\n".join(
            [
                f"route: {route.path}",
                f"title: {route.title or '-'}",
                f"doc_file: {route.doc_file}",
                "",
                preview,
            ]
        )

    @tool("get_current_page_doc")
    def get_current_page_doc_tool() -> str:
        """读取当前页面的 webAIDocs/page-xxx.md。适用于当前页表单操作或当前页问答。"""

        route = find_current_route(pathname, routes)
        if route is None:
            return "当前路径没有匹配到 routes.md 中的路由。"
        if not route.doc_file:
            return f"当前路由 {route.path} 没有关联的页面文档。"
        content = read_page_doc(route.doc_file)
        if not content.strip():
            return f"未读取到 {route.doc_file} 的内容。"
        return "\n".join(
            [
                f"route: {route.path}",
                f"title: {route.title or '-'}",
                f"doc_file: {route.doc_file}",
                "",
                truncate(content, AGENT_MAX_PAGE_DOC_CHARS),
            ]
        )

    return [search_routes_tool, get_page_doc_tool, get_current_page_doc_tool]
