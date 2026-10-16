# roundup shell marks (X15). Wraps the prompt on the first one, after the user's config has run.
function __rup_wrap --on-event fish_prompt
    if not set -q __rup_wrapped
        set -g __rup_wrapped 1
        functions -c fish_prompt __rup_user_prompt
        function fish_prompt
            printf '\e]133;A\a'
            __rup_user_prompt
            printf '\e]133;B\a'
        end
    end
    printf '\e]7;file://%s%s\a' (hostname) $PWD
end
function __rup_preexec --on-event fish_preexec
    printf '\e]133;C\a'
end
function __rup_postexec --on-event fish_postexec
    printf '\e]133;D;%s\a' $status
end
