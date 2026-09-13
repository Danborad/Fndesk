#!/bin/bash
# Fndesk Lite CGI Gateway
set -uo pipefail

TARGET_HOST="127.0.0.1"
TARGET_PORT="9990"
TARGET_URL="http://${TARGET_HOST}:${TARGET_PORT}"

REQUEST_METHOD=${REQUEST_METHOD:-GET}
REQUEST_URI=${REQUEST_URI:-/}
URI_NO_QUERY=${REQUEST_URI%%\?*}
QUERY_STRING=${QUERY_STRING:-}

REL_PATH="/"
if [[ "$URI_NO_QUERY" == *index.cgi* ]]; then
    temp_path=$(echo "$URI_NO_QUERY" | awk -F 'index.cgi' '{print $NF}')
    if [[ -z "$temp_path" || "$temp_path" != /* ]]; then
        REL_PATH="/${temp_path}"
    else
        REL_PATH="$temp_path"
    fi
else
    REL_PATH="$URI_NO_QUERY"
fi
REL_PATH=${REL_PATH:-/}
[[ "$REL_PATH" == "" ]] && REL_PATH="/"

if [[ -n "$QUERY_STRING" ]]; then
    FULL_TARGET="${TARGET_URL}${REL_PATH}?${QUERY_STRING}"
else
    FULL_TARGET="${TARGET_URL}${REL_PATH}"
fi

# 组装请求头
HEADER_ARGS=()
for var in "${!HTTP_@}"; do
    header_name=$(echo "${var#HTTP_}" | tr '[:upper:]' '[:lower:]' | sed 's/_/-/g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1' OFS='-')
    header_value="${!var}"
    HEADER_ARGS+=("-H" "$header_name: $header_value")
done

CURL_OPTS=("-i" "--connect-timeout" "10" "--max-time" "60" "-s" "--path-as-is")

case "$REQUEST_METHOD" in
    GET|HEAD|DELETE)
        curl "${CURL_OPTS[@]}" -X "$REQUEST_METHOD" "${HEADER_ARGS[@]}" "$FULL_TARGET"
        ;;
    POST|PUT|PATCH)
        if [[ -n "${CONTENT_TYPE:-}" ]]; then
            HEADER_ARGS+=("-H" "Content-Type: ${CONTENT_TYPE}")
        fi
        cat | curl "${CURL_OPTS[@]}" -X "$REQUEST_METHOD" "${HEADER_ARGS[@]}" --data-binary @- "$FULL_TARGET"
        ;;
    OPTIONS)
        echo -e "Status: 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, x-auth-token\r\n\r\n"
        ;;
    *)
        echo -e "Status: 405 Method Not Allowed\r\nContent-Type: text/plain\r\n\r\nMethod Not Allowed"
        ;;
esac

exit 0
