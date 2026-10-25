#define FUSE_USE_VERSION 31
#include <fuse3/fuse.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>

/* libfuse owns the protocol. The read reply is gated by the test's pipe. */
static int attributes(const char *path, struct stat *st, struct fuse_file_info *fi) {
    (void)fi;
    memset(st, 0, sizeof(*st));
    st->st_uid = getuid();
    st->st_gid = getgid();
    if (!strcmp(path, "/")) { st->st_mode = S_IFDIR | 0755; st->st_nlink = 2; }
    else if (!strcmp(path, "/held")) { st->st_mode = S_IFREG | 0444; st->st_nlink = 1; st->st_size = 8192; }
    else return -ENOENT;
    return 0;
}
static int read_file(const char *path, char *buf, size_t size, off_t offset, struct fuse_file_info *fi) {
    (void)path; (void)fi;
    puts("HELD");
    if (getchar() != 'R') return -EIO;
    if (offset >= 8192) return 0;
    if (size > 8192 - (size_t)offset) size = 8192 - (size_t)offset;
    memset(buf, 'Q', size);
    return (int)size;
}
static void *ready(struct fuse_conn_info *conn, struct fuse_config *config) {
    (void)conn;
    config->kernel_cache = 1;
    puts("MOUNTED");
    return NULL;
}
int main(int argc, char **argv) {
    setbuf(stdout, NULL);
    if (argc == 3 && !strcmp(argv[1], "burst")) {
        int fd = open(argv[2], O_RDWR | O_CREAT | O_TRUNC, 0600);
        char data[8192];
        memset(data, 'Q', sizeof(data));
        if (fd < 0 || write(fd, data, sizeof(data)) != sizeof(data) || fsync(fd)) return 1;
        for (int i = 0; i < 16384; i++) {
            if (posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED)) return 2;
            volatile char *address = mmap(NULL, sizeof(data), PROT_READ, MAP_PRIVATE, fd, 0);
            if (address == MAP_FAILED || address[4096] != 'Q') return 3;
            if (munmap((void *)address, sizeof(data))) return 4;
        }
        close(fd);
        puts("BURST");
        return 0;
    }
    if (argc == 3 && !strcmp(argv[1], "read")) {
        pid_t child = fork();
        if (child < 0) { perror("fork"); return 1; }
        if (child > 0) {
            int status;
            if (waitpid(child, &status, 0) != child) return 1;
            return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
        }
        /* A renamed descendant still belongs to the selected Chrome root. */
        prctl(PR_SET_NAME, "held-reader", 0, 0, 0);
        int fd = open(argv[2], O_RDONLY);
        if (fd < 0) { perror("open"); return 1; }
        volatile char *address = mmap(NULL, 4096, PROT_READ, MAP_PRIVATE, fd, 4096);
        if (address == MAP_FAILED) { perror("mmap"); return 1; }
        printf("MAPPED %d %ld %lx\n", getpid(), syscall(SYS_gettid), (unsigned long)address);
        if (getchar() != 'G') return 2;
        char value = address[17];
        printf("VALUE %c\n", value);
        munmap((void *)address, 4096);
        close(fd);
        return value == 'Q' ? 0 : 3;
    }
    struct fuse_operations ops = { .getattr = attributes, .read = read_file, .init = ready };
    char *args[] = {argv[0], "-f", "-s", argv[1]};
    return fuse_main(4, args, &ops, NULL);
}
